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
import { PlaceFolders } from "../config/place-folders.js";
import { PlacePorts } from "../config/place-ports.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { CodeFinder } from "./code-finder.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlan } from "./init-service.js";
import { InitQuestions } from "./init-questions.js";

const WORKSPACE_SUFFIX = ".code-workspace";

/** What the config that lists the place says: the entries of `placePaths` once the place is in them, what the file holds, and the edit that gets them there. */
interface Listing {
	readonly placePaths: readonly string[];
	readonly raw: Record<string, unknown>;
	readonly edit?: PlannedFile;
}

/** A place of the config that lists it, as far as its port is concerned. */
interface KnownPlace {
	readonly directory: string;
	readonly pinned: number | undefined;
}

/** Adds a folder as a place of the config above it: the place's own `rogen.json`, the entry in `placePaths` that lists it, and the workspace file that lists every place. */
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
		const enclosing = await this.configService.findEnclosing(folder);
		if (!enclosing)
			return err(
				new UsageError(
					`No ${CONFIG_FILE_NAMES[0]} found above ${folder}. Run 'rogen init' in the folder that holds the code the places share first.`
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
		if (entry.status === "broken")
			return err(new DiagnosticsError(entry.errors));

		const listed = await this.listing(rootFile, root, folder);
		if (listed.isErr()) return listed;
		if (listed.value === "cancelled") return ok(undefined);
		const known = await this.knownPlaces(
			root,
			listed.value.placePaths,
			listed.value.raw
		);

		const sourcePaths = await this.sourcePaths(folder, root);
		if (sourcePaths === undefined) return ok(undefined);
		const port = this.portOf(folder, known);

		const place = path.relative(root, folder);
		const placeRoute = toPosix(place);
		const config: RogenConfig = {
			servePort: port,
			...(sourcePaths.sourcePaths && {
				sourcePaths: sourcePaths.sourcePaths,
			}),
			...(sourcePaths.syncPath && { syncPath: sourcePaths.syncPath }),
		};
		const folders = [
			...new Set([...known.map((one) => one.directory), folder]),
		]
			.map((directory) => toPosix(path.relative(root, directory)))
			.sort(compareStrings);
		const workspace = await this.workspace(root, folders, placeRoute);

		const files: PlannedFile[] = [
			...(listed.value.edit ? [listed.value.edit] : []),
			{
				fileName: path.posix.join(placeRoute, CONFIG_FILE_NAMES[0]),
				content: configFileContent(config),
			},
			...(workspace.file ? [workspace.file] : []),
		];
		return ok({
			directory: root,
			files,
			directories: sourcePaths.directories.map((directory) =>
				path.posix.join(placeRoute, directory)
			),
			configs: [toPosix(path.relative(this.cwd, folder)) || "."],
			notes: [
				`${path.basename(folder)} is served on port ${port}, which its ${path.posix.join(placeRoute, CONFIG_FILE_NAMES[0])} pins so adding another place never moves it.`,
				...workspace.notes,
			],
			nextSteps: {
				setup: [],
				run: ["rogen serve"],
				darklua: [],
				edits: [
					`Put the code of ${path.basename(folder)} in ${path.posix.join(placeRoute, sourcePaths.directories[0] ?? DEFAULT_SOURCE_PATH)}: it gets the routes and the tree of ${this.named(rootFile)}, and the code in its source paths wins a clash with the shared code.`,
				],
			},
			asked: this.questions.interactive,
		});
	}

	/** The config file in `folder`, if it has one. */
	private async configIn(folder: string): Promise<string | undefined> {
		for (const name of CONFIG_FILE_NAMES) {
			const file = path.join(folder, name);
			if (await this.fileSystemService.isFile(file)) return file;
		}
		return undefined;
	}

	/** `file` as a command run here names it. */
	private named(file: string): string {
		return toPosix(path.relative(this.cwd, file)) || file;
	}

	/** The edit of `rootFile` that lists the place, none when its `placePaths` already do. */
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
		if (rootFile.endsWith("c"))
			return err(
				new UsageError(
					`${this.named(rootFile)} may hold comments, which Rogen would lose by rewriting it. Add ${JSON.stringify(placePaths)} as "placePaths" there yourself: "placePaths": ${JSON.stringify(placePaths)}.`
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

	/** The places `placePaths` names that are there now, each with the port it pins, its own or the one it inherits. */
	private async knownPlaces(
		root: string,
		placePaths: readonly string[],
		raw: Record<string, unknown>
	): Promise<KnownPlace[]> {
		const folders = await PlaceFolders.find(
			this.fileSystemService,
			root,
			placePaths
		);
		return Promise.all(
			folders.map(async (directory) => {
				const file = await this.configIn(directory);
				const own = file
					? await this.rawConfig(file)
					: ({} as Record<string, unknown>);
				return {
					directory,
					pinned: PlacePorts.pinnedBy(own.servePort ?? raw.servePort),
				};
			})
		);
	}

	private async rawConfig(file: string): Promise<Record<string, unknown>> {
		const parsed = parse(await this.fileSystemService.readFile(file));
		return parsed.isOk() && isObject(parsed.value) ? parsed.value : {};
	}

	/** The place's own source paths, when they are not `src`, and what a compiler asks of the place. */
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

	/** The port the place is served on: the first free one among the places, counted by path, with the others as they are. */
	private portOf(folder: string, known: readonly KnownPlace[]): number {
		const places = [
			...known.filter(
				({ directory }) => toPosix(directory) !== toPosix(folder)
			),
			{ directory: folder, pinned: undefined },
		].sort((a, b) =>
			compareStrings(toPosix(a.directory), toPosix(b.directory))
		);
		const ports = PlacePorts.assign(places.map(({ pinned }) => pinned));
		return ports[
			places.findIndex(
				({ directory }) => toPosix(directory) === toPosix(folder)
			)
		] as number;
	}

	/** The workspace file that lists the config's folder and every place, unless one is there already, and then what to add to it. */
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
