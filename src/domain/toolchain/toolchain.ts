import path from "path";
import { commonAncestor, toPosix } from "../../base/path.js";

export interface MetaReplacement {
	readonly suffix: string;
	/** Says why, in the warning about the meta Rojo no longer applies. */
	readonly note: string;
}

export interface DataReplacement {
	/** What the module's name ends in instead of the data file's extension. */
	readonly suffix: string;
	/** Says which data files, in the warning about the file Rojo no longer finds. */
	readonly note: string;
}

/** A tool that rewrites code between the source paths and the sync path. */
export interface SyncTool {
	readonly id: string;
	emittedPath?(source: string): string;
	readsOnly?(source: string): boolean;
	/** A script name the tool writes as Rojo's `init`, which makes the file its folder too. */
	readonly initName?: string;
	readonly metaReplacement?: MetaReplacement;
	readonly dataReplacement?: DataReplacement;
}

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

export interface PlannedFile {
	readonly fileName: string;
	readonly content: string;
	/** Set when the file already exists: names what `content` adds to it. */
	readonly addition?: string;
}

/** A folder placed in the game as it is, never scanned or routed. */
export interface Mount {
	readonly path: string;
	readonly optional: boolean;
	/** The instance path the folder becomes, such as `ReplicatedStorage/Packages`. */
	readonly landing: string;
}

export interface MountCandidate {
	readonly path: string;
	readonly installed: boolean;
	readonly landing: string;
	readonly ticked: boolean;
}

export interface Compiler {
	/** Names the compiler in notes, such as "Syncing from out, where roblox-ts compiles to." */
	readonly name: string;
	readonly outDir: string;
	readonly compileCommand: string;
	/** The edit that makes it compile the shared code from `sourcePath`, when its config compiles another folder. */
	sourcePathStep(sourcePath: string): string;
}

export interface LanguageCopy {
	readonly label: string;
	readonly detectedHint?: string;
	readonly packagesNote?: string;
	/** Only for a language whose compiler reads a single source path. */
	readonly sourcePath?: {
		readonly description: string;
		readonly severalProblem: string;
	};
}

export interface Language {
	readonly id: string;
	readonly copy: LanguageCopy;
	/** The script extension written in examples, such as `Analytics.mock.luau`. */
	readonly extension: string;
	readonly defaultPackageManager?: PackageManager;
	readonly compiler?: Compiler;
	/** Whether the workspace uses this language. Whether or not it does, the user may still pick it. */
	readonly present: boolean;
	/** Top-level folders holding the language's own files, never offered as code folders. */
	readonly reservedFolders: readonly string[];

	/** How a route key is spelled, such as Luau's `Server` or roblox-ts's `server`. */
	routeKey(id: string): string;
	/** The source path the language's own config names, if any; `init` prefers it. */
	configuredSourcePath(): string | undefined;
	/** Folders mounted without asking. */
	alwaysMounted(): readonly MountCandidate[];
	offeredMounts(): readonly MountCandidate[];
}

export interface LanguageDetector {
	detect(cwd: string): Promise<Language>;
}

interface DetectedWorkspaceFields {
	readonly darklua: Darklua;
	readonly languages: readonly Language[];
	readonly darkluaConfig?: string;
	readonly packageManager?: PackageManager;
	readonly packageDirs: ReadonlySet<string>;
	readonly testRunner?: string;
}

/** What `init` found in the workspace: facts only, never decisions. */
export class DetectedWorkspace {
	readonly darklua: Darklua;
	readonly languages: readonly Language[];
	readonly darkluaConfig?: string;
	readonly packageManager?: PackageManager;
	readonly packageDirs: ReadonlySet<string>;
	readonly testRunner?: string;

	constructor(fields: DetectedWorkspaceFields) {
		if (fields.languages.length === 0) {
			throw new Error("A workspace needs at least one language.");
		}
		this.darklua = fields.darklua;
		this.languages = fields.languages;
		this.darkluaConfig = fields.darkluaConfig;
		this.packageManager = fields.packageManager;
		this.packageDirs = fields.packageDirs;
		this.testRunner = fields.testRunner;
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

/** Darklua, the one processor `init` sets up. */
export class Darklua {
	static readonly SYNC_TOOL: SyncTool = {
		id: "darklua",
		metaReplacement: {
			suffix: ".meta.lua",
			note: "Darklua converts every .meta.json this way.",
		},
		dataReplacement: {
			suffix: ".lua",
			note: "Darklua converts .txt, .json, .toml, .yaml and .yml files this way, and has no option to copy them.",
		},
	};

	readonly defaultSyncPath = "dist";
	readonly configFiles: readonly string[] = [
		".darklua.json",
		".darklua.json5",
	];

	sourcemapCommand(projectFile: string): string {
		return `rojo sourcemap ${projectFile} --output sourcemap.json --watch`;
	}

	/** One `darklua process` per directory, each landing at its path relative to their common root. */
	processCommands(
		directory: string,
		sourceDirs: readonly string[],
		syncPath: string
	): string[] {
		const absolute = sourceDirs.map((dir) => path.resolve(directory, dir));
		const common = commonAncestor(absolute);
		return sourceDirs.map((dir, index) => {
			const relative = toPosix(path.relative(common, absolute[index]));
			return `darklua process ${dir} ${relative ? `${syncPath}/${relative}` : syncPath}`;
		});
	}
}
