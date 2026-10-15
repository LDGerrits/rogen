import path from "path";
import { compareStrings } from "../../base/collections.js";
import { isMatch } from "../../base/glob.js";
import { formatJsonFile } from "../../base/json.js";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { toPosix } from "../../base/path.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import {
	CONFIG_FILE_NAMES,
	DEFAULT_SOURCE_PATH,
	RogenConfig,
	configFileContent,
} from "../config/config.js";
import { ConfigService } from "../config/config-service.js";
import { PlaceFinder } from "../config/place-finder.js";
import { PlacePorts } from "../config/place-ports.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { CodeFinder } from "./code-finder.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlan } from "./init-service.js";
import { InitQuestions } from "./init-questions.js";

const WORKSPACE_SUFFIX = ".code-workspace";

interface Listing {
	readonly placePaths: readonly string[];
	readonly raw: Record<string, unknown>;
	readonly edit?: PlannedFile;
}

interface KnownPlace {
	readonly directory: string;
	readonly pinned: number | undefined;
}

export class PlaceInit {
	private readonly finder: PlaceFinder;
	private readonly code: CodeFinder;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly questions: InitQuestions,
		private readonly toolchainService: ToolchainService,
		private readonly configService: ConfigService,
		private readonly cwd: string
	) {
		this.finder = new PlaceFinder(fileSystemService);
		this.code = new CodeFinder(fileSystemService);
	}

	async plan(target: string): Promise<Result<InitPlan | undefined, Error>> {
		const folder = path.resolve(this.cwd, target);
		const located = await this.locate(folder);
		if (located.isErr()) return located;
		const { root, rootFile } = located.value;

		const listed = await this.listing(rootFile, root, folder);
		if (listed.isErr()) return listed;
		if (listed.value === "cancelled") return ok(undefined);
		const known = await this.knownPlaces(root, listed.value.placePaths);
		const sourcePaths = await this.sourcePaths(folder, root);
		if (sourcePaths === undefined) return ok(undefined);

		const placeIds = await this.questions.placeIds(path.basename(folder));
		if (placeIds === undefined) return ok(undefined);

		const port = this.portOf(folder, known);
		const place = toPosix(path.relative(root, folder));
		const workspace = await this.workspace(
			root,
			[...new Set([...known.map((one) => one.directory), folder])]
				.map((directory) => toPosix(path.relative(root, directory)))
				.sort(compareStrings),
			place
		);
		const config: RogenConfig = {
			servePort: port,
			...(placeIds.length > 0 && { servePlaceIds: [...placeIds] }),
			...(sourcePaths.sourcePaths && {
				sourcePaths: sourcePaths.sourcePaths,
			}),
			...(sourcePaths.syncPath && { syncPath: sourcePaths.syncPath }),
		};
		const configFile = path.posix.join(place, CONFIG_FILE_NAMES[0]);
		return ok({
			directory: root,
			files: [
				...(listed.value.edit ? [listed.value.edit] : []),
				{ fileName: configFile, content: configFileContent(config) },
				...(workspace.file ? [workspace.file] : []),
			],
			directories: sourcePaths.directories.map((directory) =>
				path.posix.join(place, directory)
			),
			configs: [toPosix(path.relative(this.cwd, folder)) || "."],
			warnings: [],
			notes: [
				`${path.basename(folder)} is served on port ${port}, which its ${configFile} pins so adding another place never moves it.`,
				...workspace.notes,
			],
			nextSteps: {
				setup: [],
				run: ["rogen serve"],
				darklua: [],
				edits: [
					`Put the code of ${path.basename(folder)} in ${path.posix.join(place, sourcePaths.directories[0] ?? DEFAULT_SOURCE_PATH)}: it gets the routes and the tree of ${this.named(rootFile)}, and the code in its source paths wins a clash with the shared code.`,
				],
			},
			asked: this.questions.interactive,
			decided: this.questions.decided,
		});
	}

	private async locate(
		folder: string
	): Promise<Result<{ root: string; rootFile: string }, Error>> {
		const enclosing = await this.configService.findEnclosing(folder);
		if (!enclosing)
			return err(
				new UsageError(
					`No ${CONFIG_FILE_NAMES[0]} found above ${folder}.`,
					"Run 'rogen init' in the folder that holds the code the places share first."
				)
			);
		if (enclosing.fileNames.length > 1)
			return err(
				new UsageError(
					`${enclosing.directory} holds both ${CONFIG_FILE_NAMES.join(" and ")}; keep one.`
				)
			);
		const root = enclosing.directory;
		const rootFile = path.join(root, enclosing.fileNames[0]);
		const above = await this.finder.rootOf(root);
		if (above)
			return err(
				new UsageError(
					`${this.named(rootFile)} is a place of ${this.named(above)}, and a place can't list places. Add the folder to ${this.named(above)} instead.`
				)
			);
		const taken = await this.configIn(folder);
		if (taken)
			return err(
				new DiagnosticsError([
					errorDiagnostic(
						"init.configExists",
						{ resource: taken },
						"this config already exists. Delete it to write a new one."
					),
				])
			);
		const entry = await this.configService.read(rootFile);
		return entry.status === "broken"
			? err(new DiagnosticsError(entry.errors))
			: ok({ root, rootFile });
	}

	private async configIn(folder: string): Promise<string | undefined> {
		for (const name of CONFIG_FILE_NAMES) {
			const file = path.join(folder, name);
			if (await this.fileSystemService.isFile(file)) return file;
		}
		return undefined;
	}

	private named(file: string): string {
		return toPosix(path.relative(this.cwd, file)) || file;
	}

	private async listing(
		rootFile: string,
		root: string,
		folder: string
	): Promise<Result<Listing | "cancelled", Error>> {
		const raw = await this.rawConfig(rootFile);
		const globs = Array.isArray(raw.placePaths)
			? raw.placePaths.filter(
					(glob): glob is string => typeof glob === "string"
				)
			: [];
		const relative = toPosix(path.relative(root, folder));
		if (
			globs.some((glob) =>
				isMatch(relative, glob.replace(/^\.\//, "").replace(/\/$/, ""))
			)
		)
			return ok({ placePaths: globs, raw });

		const parent = path.posix.dirname(relative);
		const entry =
			parent === "."
				? relative
				: await this.questions.placeListing(`${parent}/*`, relative);
		if (entry === undefined) return ok("cancelled");
		const placePaths = [...globs, entry];
		if (
			!PlaceInit.isStrictJson(
				await this.fileSystemService.readFile(rootFile)
			)
		)
			return err(
				new UsageError(
					`${this.named(rootFile)} holds comments or a trailing comma, which Rogen would lose by rewriting it. Add this key to it yourself: "placePaths": ${JSON.stringify(placePaths)}.`
				)
			);
		return ok({
			placePaths,
			raw,
			edit: {
				fileName: path.relative(root, rootFile),
				content: formatJsonFile({ ...raw, placePaths }),
				addition: `"${entry}" as a place path`,
			},
		});
	}

	private async knownPlaces(
		root: string,
		placePaths: readonly string[]
	): Promise<KnownPlace[]> {
		const folders = await this.finder.folders(root, placePaths);
		return Promise.all(
			folders.map(async (directory) => {
				const file = await this.configIn(directory);
				const own = file
					? await this.rawConfig(file)
					: ({} as Record<string, unknown>);
				return {
					directory,
					pinned: PlacePorts.pinnedBy(own.servePort),
				};
			})
		);
	}

	private static isStrictJson(text: string): boolean {
		try {
			JSON.parse(text);
			return true;
		} catch {
			return false;
		}
	}

	private async rawConfig(file: string): Promise<Record<string, unknown>> {
		const parsed = parse(await this.fileSystemService.readFile(file));
		return parsed.isOk() && isObject(parsed.value) ? parsed.value : {};
	}

	private async sourcePaths(
		folder: string,
		root: string
	): Promise<
		| {
				sourcePaths?: string[];
				syncPath?: string;
				directories: string[];
		  }
		| undefined
	> {
		const exists = await this.fileSystemService.isDirectory(folder);
		const workspace = await this.toolchainService.detect(
			exists ? folder : root
		);
		const entries = exists
			? (await this.fileSystemService.readDirectory(folder)).map(
					([name]) => name
				)
			: [];
		const directory = new InitDirectory(
			folder,
			new Set(entries),
			workspace,
			exists
				? await this.code.layoutOf(folder, workspace)
				: { codeFolders: [] }
		);
		const answered = await this.questions.sourcePaths(
			directory,
			workspace.language
		);
		if (answered === undefined) return undefined;
		const syncPath = workspace.language.compiler?.outDir;
		return {
			...(answered.join() !== DEFAULT_SOURCE_PATH && {
				sourcePaths: answered,
			}),
			...(syncPath && { syncPath }),
			directories: answered,
		};
	}

	private portOf(folder: string, known: readonly KnownPlace[]): number {
		const others = known
			.filter(({ directory }) => toPosix(directory) !== toPosix(folder))
			.sort((a, b) =>
				compareStrings(toPosix(a.directory), toPosix(b.directory))
			);
		const pinned = others.map(({ pinned }) => pinned);
		const taken = new Set([
			...pinned.filter((port) => port !== undefined),
			...PlacePorts.assign(pinned).filter((port) => port !== undefined),
		]);
		return PlacePorts.firstFree(taken);
	}

	private async workspace(
		root: string,
		folders: readonly string[],
		place: string
	): Promise<{ file?: PlannedFile; notes: string[] }> {
		const entries = await this.fileSystemService.readDirectory(root);
		const present = entries
			.map(([name]) => name)
			.find((name) => name.endsWith(WORKSPACE_SUFFIX));
		if (present !== undefined)
			return {
				notes: [
					`${present} is there already: add the folder "${place}" to ${present} so the editor runs a language server for the place.`,
				],
			};
		return {
			file: {
				fileName: `${path.basename(root)}${WORKSPACE_SUFFIX}`,
				content: formatJsonFile({
					folders: [
						{ path: "." },
						...folders.map((one) => ({ path: one })),
					],
				}),
			},
			notes: [],
		};
	}
}
