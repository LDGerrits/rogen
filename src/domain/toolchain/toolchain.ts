import path from "path";
import { commonAncestor, toPosix } from "../../base/path.js";

/** A package manager: where it keeps its manifest and installed packages, and how they mount. */
export class PackageManager {
	static readonly WALLY = new PackageManager(
		"wally",
		"wally.toml",
		"Packages",
		"ServerPackages"
	);
	static readonly PESDE = new PackageManager(
		"pesde",
		"pesde.toml",
		"roblox_packages",
		"roblox_server_packages"
	);
	/** In the order they win when a workspace has several manifests. */
	static readonly PRIORITY: readonly PackageManager[] = [
		PackageManager.PESDE,
		PackageManager.WALLY,
	];

	private static readonly SHARED_LANDING = "ReplicatedStorage/Packages";
	private static readonly SERVER_LANDING =
		"ServerScriptService/ServerPackages";

	private constructor(
		readonly id: string,
		readonly manifest: string,
		/** Installed packages every side requires. */
		readonly shared: string,
		/** Installed packages only the server requires. */
		readonly server: string
	) {}

	/** The folders it offers to mount; a manifest means packages are coming, so they start ticked. */
	mounts(
		installedDirs: ReadonlySet<string>,
		hasManifest: boolean
	): MountCandidate[] {
		const offer = (dir: string, landing: string): MountCandidate => {
			const installed = installedDirs.has(dir);
			return {
				path: dir,
				installed,
				landing,
				ticked: installed || hasManifest,
			};
		};
		return [
			offer(this.shared, PackageManager.SHARED_LANDING),
			offer(this.server, PackageManager.SERVER_LANDING),
		];
	}
}

/** Where a repo that builds several places keeps each place's own code. */
export const PLACES_DIR = "places";

/** A file `init` writes, relative to the directory it runs in. */
export interface PlannedFile {
	readonly fileName: string;
	readonly content: string;
}

/** A folder placed in the game as it is, never scanned or routed. */
export interface Mount {
	readonly path: string;
	/** A mount that isn't installed yet is written as an optional `$path`. */
	readonly optional: boolean;
	/** The instance path the folder becomes, such as `ReplicatedStorage/Packages`. */
	readonly landing: string;
}

/** A mount as the packages question offers it. */
export interface MountCandidate {
	readonly path: string;
	readonly installed: boolean;
	readonly landing: string;
	/** Whether the question starts with it ticked. */
	readonly ticked: boolean;
}

/** What a compiler adds for a place, so it builds that place on its own. */
export interface CompiledPlace {
	readonly files: readonly PlannedFile[];
	/** One-time edits before anything runs. */
	readonly setup: readonly string[];
	/** Replaces the project-wide compile command for this place. */
	readonly compileCommand: string;
}

export interface CompilerPlaceRequest {
	readonly name: string;
	/** The place's root dirs: the shared ones plus its own folder. */
	readonly rootDirs: readonly string[];
	/** The root dirs the place shares with every other. */
	readonly sharedRootDirs: readonly string[];
	/** Where the compiler writes this place's code. */
	readonly outDir: string;
	/** The project file Rojo serves for this place. */
	readonly projectFile: string;
}

/** A compile step between the root dirs and what Rojo syncs, as roblox-ts has, as this workspace configures it. */
export interface Compiler {
	/** Names the compiler in notes, such as "Syncing from out, where roblox-ts compiles to." */
	readonly name: string;
	/** Where it writes here, and so what Rojo or a processor reads instead of the root dirs. */
	readonly outDir: string;
	/** Where it writes when its own config doesn't say. */
	readonly defaultOutDir: string;
	/** The long-running compile, which keeps its own terminal busy. */
	readonly compileCommand: string;
	/** The files a place named `name` adds, beside its config and project file. */
	placeFileNames(name: string): readonly string[];
	planPlace(request: CompilerPlaceRequest): CompiledPlace;
}

/** A language `init` can set up, as this workspace uses it; what differs between languages is answered here. */
export interface Language {
	readonly id: string;
	/** The script extension written in examples, such as `Analytics.mock.luau`. */
	readonly extension: string;
	/** The package manager offered when the workspace has none. */
	readonly defaultPackageManager?: PackageManager;
	/** Set when code is compiled before Rojo syncs it. */
	readonly compiler?: Compiler;
	/** Whether the workspace uses this language. Whether or not it does, the user may still pick it. */
	readonly present: boolean;
	/** Top-level folders holding the language's own files, never offered as code folders. */
	readonly reservedFolders: readonly string[];

	/** How a route key is spelled, such as Luau's `Server` or roblox-ts's `server`. */
	routeKey(id: string): string;
	/** The root dir the language's own config names, if any; `init` prefers it. */
	configuredRootDir(): string | undefined;
	/** Folders mounted without asking. */
	alwaysMounted(): readonly MountCandidate[];
	/** Folders the packages question offers beside the package manager's. */
	offeredMounts(): readonly MountCandidate[];
}

/** Reads what a workspace holds of one language. */
export interface LanguageDetector {
	detect(cwd: string): Promise<Language>;
}

export interface DetectedWorkspaceFields {
	readonly darklua: Darklua;
	/** Every language, as the language question lists them. The first is the one assumed when none is present. */
	readonly languages: readonly Language[];
	/** Whether the workspace has a Darklua config. */
	readonly usesDarklua: boolean;
	readonly packageManager?: PackageManager;
	/** The installed package directories, of any manager. */
	readonly packageDirs: ReadonlySet<string>;
	/** Top-level folders holding Luau or TypeScript code, sorted. */
	readonly codeFolders: readonly string[];
	readonly hasSrc: boolean;
	/** The folders directly inside `places/`, sorted. */
	readonly places: readonly string[];
}

/** What `init` found in the workspace: facts only, never decisions. */
export class DetectedWorkspace {
	/** Darklua as this workspace can be set up for it. */
	readonly darklua: Darklua;
	readonly languages: readonly Language[];
	readonly usesDarklua: boolean;
	readonly packageManager?: PackageManager;
	readonly packageDirs: ReadonlySet<string>;
	readonly codeFolders: readonly string[];
	readonly hasSrc: boolean;
	readonly places: readonly string[];

	constructor(fields: DetectedWorkspaceFields) {
		if (fields.languages.length === 0) {
			throw new Error("A workspace needs at least one language.");
		}
		this.darklua = fields.darklua;
		this.languages = fields.languages;
		this.usesDarklua = fields.usesDarklua;
		this.packageManager = fields.packageManager;
		this.packageDirs = fields.packageDirs;
		this.codeFolders = fields.codeFolders;
		this.hasSrc = fields.hasSrc;
		this.places = fields.places;
	}

	/** The language the workspace uses, or the first one when it uses none. */
	get language(): Language {
		return (
			this.languages.find(({ present }) => present) ?? this.languages[0]
		);
	}

	/** @throws Error if `id` isn't a language Rogen knows, which is a programmer error. */
	languageFor(id: string): Language {
		const language = this.languages.find(
			(candidate) => candidate.id === id
		);
		if (!language) throw new Error(`Language "${id}" is not registered.`);
		return language;
	}

	/** The package manager's folders, offered for `language`. */
	packageMounts(language: Language): MountCandidate[] {
		const manager = this.packageManager ?? language.defaultPackageManager;
		return (
			manager?.mounts(
				this.packageDirs,
				this.packageManager !== undefined
			) ?? []
		);
	}
}

/** What a tool writes in place of a `.meta.json`. */
export interface MetaReplacement {
	readonly suffix: string;
	/** Says why, in the warning about the meta Rojo no longer applies. */
	readonly note: string;
}

/** A tool that rewrites code between the root dirs and the sync dir, which Rojo reads in their place. */
export interface SyncTool {
	readonly id: string;
	/** The path the tool writes for a source path, when it renames it. */
	emittedPath?(source: string): string;
	/** Whether the tool reads a source but never writes anything for it. */
	readsOnly?(source: string): boolean;
	/** What it writes instead of a `.meta.json`, which Rojo then no longer applies. */
	readonly metaReplacement?: MetaReplacement;
}

/** Darklua, the one processor `init` sets up: it writes processed code into the sync dir, which Rojo syncs instead. */
export class Darklua implements SyncTool {
	readonly id = "darklua";
	/** Where Darklua writes unless told otherwise. */
	readonly defaultSyncDir = "dist";
	readonly configFiles: readonly string[] = [
		".darklua.json",
		".darklua.json5",
	];
	readonly metaReplacement: MetaReplacement = {
		suffix: ".meta.lua",
		note: "Darklua converts every .meta.json this way.",
	};

	/** One `darklua process` per directory, each landing at its path relative to their common root. */
	processCommands(
		directory: string,
		sourceDirs: readonly string[],
		syncDir: string
	): string[] {
		const absolute = sourceDirs.map((dir) => path.resolve(directory, dir));
		const common = commonAncestor(absolute);
		return sourceDirs.map((dir, index) => {
			const relative = toPosix(path.relative(common, absolute[index]));
			return `darklua process ${dir} ${relative ? `${syncDir}/${relative}` : syncDir}`;
		});
	}
}
