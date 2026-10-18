import path from "path";
import { isMatch } from "../../base/glob.js";
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
	configText,
} from "../config/config.js";
import { ConfigService } from "../config/config-service.js";
import { PlaceFinder } from "../config/place-finder.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { CodeFinder } from "./code-finder.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlan } from "./init-service.js";
import { InitQuestions } from "./init-questions.js";
import { KnownPlaces } from "./known-places.js";
import { WorkspaceFiles } from "./workspace-files.js";

interface Listing {
	readonly placePaths: readonly string[];
	readonly raw: Record<string, unknown>;
	readonly edit?: PlannedFile;
}

export class PlaceInit {
	private readonly finder: PlaceFinder;
	private readonly code: CodeFinder;
	private readonly workspaces: WorkspaceFiles;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly questions: InitQuestions,
		private readonly toolchainService: ToolchainService,
		private readonly configService: ConfigService,
		private readonly cwd: string
	) {
		this.finder = new PlaceFinder(fileSystemService);
		this.code = new CodeFinder(fileSystemService);
		this.workspaces = new WorkspaceFiles(fileSystemService);
	}

	async plan(target: string): Promise<Result<InitPlan | undefined, Error>> {
		const folder = path.resolve(this.cwd, target);
		const located = await this.locate(folder);
		if (located.isErr()) return located;
		const { root, rootFile } = located.value;

		const listed = await this.listing(rootFile, root, folder);
		if (listed.isErr()) return listed;
		if (listed.value === "cancelled") return ok(undefined);
		const { sourcePaths: shared } = await this.finder.listingOf(rootFile);
		if (
			(
				await this.finder.sharedFolders(
					root,
					listed.value.placePaths,
					shared
				)
			).some((one) => toPosix(one) === toPosix(folder))
		)
			return err(
				new UsageError(
					`${this.named(folder)} holds a source path of ${this.named(rootFile)}, so it is the code the places share, not a place.`
				)
			);
		const known = await KnownPlaces.of(
			this.fileSystemService,
			this.finder,
			root,
			listed.value.placePaths,
			shared
		);
		const sourcePaths = await this.sourcePaths(folder, root);
		if (sourcePaths === undefined) return ok(undefined);

		const placeIds = await this.questions.placeIds(path.basename(folder));
		if (placeIds === undefined) return ok(undefined);

		const port = known.portFor(folder);
		const place = toPosix(path.relative(root, folder));
		const workspace = await this.workspaces.plan(
			root,
			known.foldersWith(root, folder),
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
				...workspace.files,
			],
			directories: sourcePaths.directories.map((directory) =>
				path.posix.join(place, directory)
			),
			commands: [],
			configs: [toPosix(path.relative(this.cwd, folder)) || "."],
			warnings: [],
			notes: [
				KnownPlaces.pinNote(path.basename(folder), port, configFile),
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
			present: [],
			gitInit: false,
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
		const taken = await this.finder.configIn(folder);
		if (taken)
			return err(
				new DiagnosticsError([
					errorDiagnostic(
						"init.configExists",
						{ resource: taken },
						"this config already exists, and init never overwrites one. Edit it to change the place."
					),
				])
			);
		const entry = await this.configService.read(rootFile);
		return entry.status === "broken"
			? err(new DiagnosticsError(entry.errors))
			: ok({ root, rootFile });
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
				content: configText({ ...raw, placePaths }),
				addition: `"${entry}" as a place path`,
			},
		});
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
}
