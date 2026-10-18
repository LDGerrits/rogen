import path from "path";
import { UsageError } from "../../base/errors.js";
import { isObject } from "../../base/objects.js";
import { normalizeDir, containsPosix } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { PER_PLACE_KEYS, defaultSourcePaths } from "../config/config.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { Language, PlannedFile } from "../toolchain/toolchain.js";
import { CodeFinder } from "./code-finder.js";
import { ConfigEdit } from "./config-edit.js";
import { InitDirectory } from "./init-directory.js";
import { oneOf } from "./init-questions.js";
import { KnownPlaces } from "./known-places.js";
import { ProjectFiles } from "./project-files.js";
import { StarterPlaces } from "./starter-places.js";
import { StartingRoutes } from "./starting-routes.js";
import { WorkspaceFiles } from "./workspace-files.js";
import { PlaceFinder } from "../config/place-finder.js";

/** The `projects` entry and `serveProject` that serve the code Darklua wrote, as init writes them. */
const PROCESSED_PROJECT = "dist";
const RELEASE_PROJECT = "release";

/** What a run changes about a project that has a config; every field is a change to make, so an empty request changes nothing. */
export interface ChangeRequest {
	/** Standard route ids to add. */
	readonly routes?: readonly string[];
	/** Standard route ids to take off. */
	readonly unroutes?: readonly string[];
	readonly unmatched?: "shared" | "leave";
	readonly sourcePaths?: readonly string[];
	readonly unsourcePaths?: readonly string[];
	readonly darklua?: boolean;
	/** Where Darklua writes, when it is added. */
	readonly syncPath?: string;
	/** Mounts to add, by path. */
	readonly packages?: readonly string[];
	/** Turn one place into several. */
	readonly places?: boolean;
	/** Add the places the editor workspace file lacks. */
	readonly workspace?: boolean;
	/** The place IDs a place is served for, none to clear them. */
	readonly placeIds?: readonly number[];
}

/** What a request writes, for the plan builder to take. */
export interface ChangePlan {
	/** The config with its changes, or none when there are none. */
	readonly config?: PlannedFile;
	readonly files: readonly PlannedFile[];
	readonly directories: readonly string[];
	readonly notes: readonly string[];
	readonly warnings: readonly Diagnostic[];
	readonly setup: readonly string[];
	readonly run: readonly string[];
	readonly edits: readonly string[];
	/** Set when the request turns Darklua on, so its pin is asked for. */
	readonly usesDarklua?: boolean;
}

const stringsOf = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((one): one is string => typeof one === "string")
		: [];

/** Every `$path` a tree mounts, as the folder it names. */
function mountedIn(node: unknown): string[] {
	if (!isObject(node)) return [];
	const own = node.$path;
	const target = isObject(own) ? own.optional : own;
	return [
		...(typeof target === "string" ? [normalizeDir(target)] : []),
		...Object.entries(node)
			.filter(([key]) => !key.startsWith("$"))
			.flatMap(([, child]) => mountedIn(child)),
	];
}

/** The changes a run makes to the config of a project, each as an edit of its text. */
export class ConfigChanges {
	private readonly notes: string[] = [];
	private readonly warnings: Diagnostic[] = [];
	private readonly files: PlannedFile[] = [];
	private readonly directories: string[] = [];
	private readonly setup: string[] = [];
	private readonly run: string[] = [];
	private readonly edits: string[] = [];
	private usesDarklua: boolean | undefined;

	constructor(
		private readonly fileSystemService: FileReader,
		private readonly directory: InitDirectory,
		private readonly edit: ConfigEdit,
		private readonly language: Language,
		/** The tree takes routes: its root is a DataModel. */
		private readonly routed: boolean,
		/** The config is a place's, which inherits the routes and has `src` for a source path. */
		private readonly place = false
	) {}

	/** The routes and source paths the config has, as the loader reads them. */
	get sourcePaths(): string[] {
		const { value } = this.edit;
		return Array.isArray(value.sourcePaths)
			? stringsOf(value.sourcePaths).map(normalizeDir)
			: defaultSourcePaths(
					this.place ||
						(isObject(value.routes) &&
							Object.keys(value.routes).length > 0)
				);
	}

	/** The keys of the routes the config has, without the one for unmatched files. */
	private routeKeys(): string[] {
		return Object.keys(this.routes).filter(
			(key) => key !== DeclaredKeys.FALLBACK_ROUTE
		);
	}

	private get routes(): Record<string, unknown> {
		const { routes } = this.edit.value;
		return isObject(routes) ? routes : {};
	}

	async apply(request: ChangeRequest): Promise<ChangePlan> {
		if (this.place) return this.applyToPlace(request);
		this.changeRoutes(request);
		this.changeUnmatched(request);
		await this.changeSourcePaths(request);
		await this.changeDarklua(request);
		this.changePackages(request);
		await this.changePlaces(request);
		await this.changeWorkspace(request);
		const config = this.edit.planned;
		return {
			...(config && { config }),
			files: this.files,
			directories: this.directories,
			notes: this.notes,
			warnings: this.warnings,
			setup: this.setup,
			run: this.run,
			edits: this.edits,
			...(this.usesDarklua !== undefined && {
				usesDarklua: this.usesDarklua,
			}),
		};
	}

	private async applyToPlace(request: ChangeRequest): Promise<ChangePlan> {
		const rootOnly: readonly [keyof ChangeRequest, string][] = [
			["routes", "--route"],
			["unroutes", "--no-route"],
			["unmatched", "--unmatched"],
			["darklua", "--darklua"],
			["packages", "--package"],
			["places", "--places"],
		];
		for (const [key, flag] of rootOnly)
			if (request[key] !== undefined)
				throw new UsageError(
					`${flag} is for the project root, and ${this.directory.path} is a place.`,
					"Run init in the folder of the root rogen.json."
				);
		await this.changeSourcePaths(request);
		if (request.syncPath !== undefined)
			this.edit.set(["syncPath"], normalizeDir(request.syncPath));
		const { placeIds } = request;
		if (placeIds !== undefined) {
			if (placeIds.length > 0) this.edit.set(["servePlaceIds"], placeIds);
			else if (this.edit.valueAt(["servePlaceIds"]) !== undefined)
				this.edit.remove(["servePlaceIds"]);
		}
		const config = this.edit.planned;
		return {
			...(config && { config }),
			files: this.files,
			directories: this.directories,
			notes: this.notes,
			warnings: this.warnings,
			setup: this.setup,
			run: this.run,
			edits: this.edits,
		};
	}

	/** The files that put the places the root lists into its editor workspace file. */
	async missingFromWorkspace(): Promise<readonly PlannedFile[]> {
		const scratch = this.files.length;
		await this.changeWorkspace({ workspace: true });
		return this.files.splice(scratch);
	}

	private needRoutes(flag: string): void {
		if (!this.routed)
			throw new UsageError(
				`${flag} is for a project that takes routes, and the tree of ${this.edit.fileName} is not a DataModel, as in a model or a plugin.`
			);
	}

	/** The key of `routes` that spells `key`, however its first letter is cased. */
	private routeKeyFor(key: string): string | undefined {
		const identity = DeclaredKeys.identityOf(key);
		return Object.keys(this.routes).find(
			(one) => DeclaredKeys.identityOf(one) === identity
		);
	}

	private changeRoutes({ routes = [], unroutes = [] }: ChangeRequest): void {
		if (routes.length + unroutes.length === 0) return;
		this.needRoutes(routes.length > 0 ? "--route" : "--no-route");
		const starting = new StartingRoutes(this.language);
		const options = starting.options;
		const optionOf = (id: string, flag: string) => {
			const known = oneOf(
				id,
				options.map((option) => option.id),
				"a standard route",
				flag
			);
			return options.find((option) => option.id === known)!;
		};
		const keys = this.routeKeys();
		const lowercase =
			keys.length > 0 &&
			keys.every((key) => key === DeclaredKeys.identityOf(key));
		for (const id of routes) {
			const { key, target } = optionOf(id, "--route");
			const there = this.routeKeyFor(key);
			if (there === undefined) {
				this.edit.set(
					["routes", lowercase ? DeclaredKeys.identityOf(key) : key],
					target
				);
				continue;
			}
			if (this.routes[there] !== target)
				this.notes.push(
					`routes.${there} goes to ${String(this.routes[there])}, not to ${target}, so it stays as it is.`
				);
			else this.notes.push(`routes.${there} is there already.`);
		}
		for (const id of unroutes) {
			const { key, target } = optionOf(id, "--no-route");
			const there = this.routeKeyFor(key);
			if (there === undefined) {
				this.notes.push(`${key} is not a route of the config.`);
				continue;
			}
			if (this.routes[there] !== target)
				throw new UsageError(
					`routes.${there} goes to ${String(this.routes[there])}, not to the standard ${target}, so init leaves it as it is.`,
					`Edit it in ${this.edit.fileName} to remove it.`
				);
			this.edit.remove(["routes", there]);
		}
	}

	private changeUnmatched({ unmatched }: ChangeRequest): void {
		if (unmatched === undefined) return;
		this.needRoutes("--unmatched");
		const fallback = DeclaredKeys.FALLBACK_ROUTE;
		const there = fallback in this.routes;
		if (unmatched === "shared") {
			const target = new StartingRoutes(this.language).sharedTarget;
			if (this.routes[fallback] === target) return;
			this.edit.set(["routes", fallback], target);
			return;
		}
		if (!there) return;
		if (Object.keys(this.routes).length === 1)
			throw new UsageError(
				"--unmatched leave has no route to apply to.",
				"Add a route with --route first, or keep the files going to the shared route."
			);
		this.edit.remove(["routes", fallback]);
	}

	private async changeSourcePaths({
		sourcePaths: added = [],
		unsourcePaths: removed = [],
	}: ChangeRequest): Promise<void> {
		if (added.length + removed.length === 0) return;
		const current = this.sourcePaths;
		const toAdd = added.map(normalizeDir);
		const toRemove = removed.map(normalizeDir);
		for (const entry of toRemove)
			if (!current.includes(entry))
				throw new UsageError(
					`${entry} is not a source path of ${this.edit.fileName}.`,
					`The source paths are ${joinedWithAnd(current)}.`
				);
		const next = [
			...current.filter((entry) => !toRemove.includes(entry)),
			...toAdd.filter((entry) => !current.includes(entry)),
		];
		if (next.length === 0)
			throw new UsageError(
				"A project needs at least one source path.",
				"Add the folder that replaces it with --source-path."
			);
		const problem = this.directory.sourcePathsProblem(next);
		if (problem) throw new UsageError(problem);
		const { compiler } = this.language;
		if (compiler && next.length > 1)
			throw new UsageError(
				this.language.copy.sourcePath?.severalProblem ??
					`${this.language.copy.label} compiles one folder.`
			);
		for (const entry of toRemove) {
			const files = await new CodeFinder(
				this.fileSystemService
			).codeFilesIn(path.join(this.directory.path, entry));
			if (files.length > 0)
				this.warnings.push(
					warningDiagnostic(
						"init.sourcePathRemoved",
						{ resource: this.edit.fileName },
						`${entry} is no longer a source path, so Rogen no longer builds ${files.length === 1 ? "this file" : `these ${files.length >= 50 ? "50 or more" : files.length} files`} in it: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ", ..." : ""}.`
					)
				);
		}
		for (const entry of toAdd.filter((one) => !current.includes(one))) {
			this.edit.set(["sourcePaths"], next, `added sourcePaths ${entry}`);
			this.directories.push(entry);
		}
		for (const entry of toRemove)
			this.edit.set(
				["sourcePaths"],
				next,
				`removed sourcePaths ${entry}`
			);
	}

	private async changeDarklua(request: ChangeRequest): Promise<void> {
		const { darklua: wanted } = request;
		if (wanted === undefined) return;
		const { value } = this.edit;
		const projects = isObject(value.projects) ? value.projects : {};
		const processed = projects[PROCESSED_PROJECT];
		const synced = isObject(processed) ? processed.syncPath : undefined;
		const ours =
			value.serveProject === PROCESSED_PROJECT &&
			isObject(processed) &&
			Object.keys(processed).length === 1 &&
			typeof synced === "string";
		if (!wanted) return this.removeDarklua(ours, synced as string);
		if (ours) {
			this.notes.push(
				`Darklua is set up already: rogen serve serves the ${PROCESSED_PROJECT} project.`
			);
			return;
		}
		if (value.serveProject !== undefined || processed !== undefined)
			throw new UsageError(
				`${this.edit.fileName} has a ${PROCESSED_PROJECT} project or a serveProject already, so init can't add Darklua's.`,
				"Add the project that serves the processed code yourself, or remove those keys first."
			);
		const { workspace } = this.directory;
		const { darklua } = workspace;
		const syncPath = request.syncPath ?? darklua.defaultSyncPath;
		this.edit.set(["projects", PROCESSED_PROJECT], { syncPath });
		this.edit.set(["serveProject"], PROCESSED_PROJECT);
		const release = projects[RELEASE_PROJECT];
		if (isObject(release) && release.syncPath === undefined)
			this.edit.set(["projects", RELEASE_PROJECT, "syncPath"], syncPath);
		if (workspace.darkluaConfig === undefined)
			this.files.push({
				fileName: darklua.configFiles[0],
				content: darklua.configFor(this.language),
			});
		this.usesDarklua = true;
		const files = new ProjectFiles(
			this.fileSystemService,
			this.directory.path
		);
		const hint = await files.gitignoreHint(syncPath);
		if (hint) this.edits.push(hint);
		this.notes.push(
			`Studio syncs from ${syncPath}, where Darklua writes: rogen serve serves the ${PROCESSED_PROJECT} project.`
		);
		const compiled = this.language.compiler?.outDir;
		this.run.push(
			...(compiled ? [this.language.compiler!.compileCommand] : []),
			...darklua.processCommands(
				this.directory.path,
				compiled ? [compiled] : this.sourcePaths,
				syncPath
			),
			"rogen serve"
		);
		if (!compiled && !(await files.luauLspIsSetUp()))
			this.edits.push(
				`Darklua reads sourcemap.json. Keep it current from default.project.json in a terminal of its own: ${darklua.sourcemapCommand()}`
			);
	}

	private removeDarklua(ours: boolean, synced: string): void {
		const { value } = this.edit;
		if (!ours) {
			if (
				value.serveProject === undefined &&
				!isObject(isObject(value.projects) && value.projects.dist)
			) {
				this.notes.push("Darklua is not set up.");
				return;
			}
			throw new UsageError(
				`The ${PROCESSED_PROJECT} project or serveProject of ${this.edit.fileName} is not what init writes, so init leaves them.`,
				`Remove "serveProject" and projects.${PROCESSED_PROJECT} yourself if Darklua is no longer used.`
			);
		}
		const projects = value.projects as Record<string, unknown>;
		this.edit.remove(["serveProject"]);
		if (Object.keys(projects).length === 1) this.edit.remove(["projects"]);
		else this.edit.remove(["projects", PROCESSED_PROJECT]);
		const release = projects[RELEASE_PROJECT];
		if (isObject(release) && release.syncPath === synced)
			this.edit.remove(["projects", RELEASE_PROJECT, "syncPath"]);
		this.notes.push(
			"Left .darklua.json and Darklua's pin as they are; remove them if nothing else uses Darklua."
		);
	}

	private changePackages({ packages }: ChangeRequest): void {
		if (packages === undefined || packages.length === 0) return;
		this.needRoutes("--package");
		const offered = [
			...this.directory.workspace.packageMounts(this.language),
			...this.language.offeredMounts(),
		];
		const mounted = mountedIn(this.edit.value.tree);
		for (const wanted of packages) {
			const mount = offered.find(
				(one) =>
					one.path ===
					oneOf(
						normalizeDir(wanted),
						offered.map(({ path: one }) => one),
						"a folder to mount",
						"--package"
					)
			)!;
			if (mounted.some((dir) => containsPosix(dir, mount.path))) {
				this.notes.push(`${mount.path} is mounted already.`);
				continue;
			}
			const node = {
				$path: mount.installed ? mount.path : { optional: mount.path },
			};
			const names = mount.landing.split("/");
			const label = `added tree.${names.join(".")}`;
			if (this.edit.valueAt(["tree"]) === undefined)
				this.edit.set(
					["tree"],
					{
						$className: "DataModel",
						...names.reduceRight<Record<string, unknown>>(
							(inner, name) => ({ [name]: inner }),
							node
						),
					},
					label
				);
			else this.edit.set(["tree", ...names], node, label);
		}
	}

	private async changePlaces({ places }: ChangeRequest): Promise<void> {
		if (places === undefined) return;
		const { value } = this.edit;
		if (!places)
			throw new UsageError(
				"--no-places would move the code of the places back into one project, which init doesn't do.",
				"Move the code and edit placePaths in rogen.json yourself."
			);
		if (stringsOf(value.placePaths).length > 0) {
			this.notes.push(
				`${this.edit.fileName} lists places already: add one with 'rogen init places/<name>'.`
			);
			return;
		}
		this.needRoutes("--places");
		const { compiler } = this.language;
		if (compiler)
			throw new UsageError(
				`--places isn't set up for ${this.language.copy.label} on a project that exists.`,
				"Start a new project with --places, or add a place with 'rogen init places/<name>'."
			);
		if (this.edit.valueAt(["projects", PROCESSED_PROJECT]) !== undefined)
			throw new UsageError(
				"--places isn't set up with Darklua yet.",
				"Add a place with 'rogen init places/<name>'."
			);
		const own = PER_PLACE_KEYS.filter((key) => key in value);
		if (own.length > 0)
			throw new UsageError(
				`${joinedWithAnd(own)} ${own.length === 1 ? "is" : "are"} set in ${this.edit.fileName}, and a config that lists places can't set ${own.length === 1 ? "it" : "them"}.`,
				"Move them into the config of a place first."
			);
		const root = this.directory.path;
		const sources = this.sourcePaths;
		const starter = await new StarterPlaces(this.fileSystemService).plan(
			root,
			undefined,
			sources
		);
		if (
			await new PlaceFinder(this.fileSystemService).configIn(
				path.join(root, starter.place)
			)
		)
			throw new UsageError(
				`${starter.place} has a config already, so it can't be the first place.`,
				"Add the folder to placePaths yourself."
			);
		this.edit.set(
			["placePaths"],
			[...starter.placePaths],
			`added placePaths ${starter.placePaths.join(", ")}`
		);
		this.files.push(...starter.files);
		this.directories.push(...starter.directories);
		this.notes.push(...starter.notes);
		this.edits.push(
			`${joinedWithAnd(sources)} stays the code every place shares. To keep it with the places, move it to places/shared/src and set "sourcePaths" in ${this.edit.fileName} to ["places/shared/src"].`,
			"Add another place with 'rogen init places/lobby'."
		);
	}

	/** The places under the root that its editor workspace file lacks. */
	private async changeWorkspace({ workspace }: ChangeRequest): Promise<void> {
		if (!workspace) return;
		const placePaths = stringsOf(this.edit.value.placePaths);
		if (placePaths.length === 0) return;
		const root = this.directory.path;
		const known = await KnownPlaces.of(
			this.fileSystemService,
			new PlaceFinder(this.fileSystemService),
			root,
			placePaths,
			this.sourcePaths
		);
		const folders = known
			.foldersWith(root, root)
			.filter((folder) => folder !== "");
		if (folders.length === 0) return;
		const planned = await new WorkspaceFiles(
			this.fileSystemService
		).planAll(root, folders, folders);
		this.files.push(...planned.files);
		this.notes.push(...planned.notes);
	}
}
