export interface MetaReplacement {
	readonly suffix: string;
	readonly note: string;
}

export interface DataReplacement {
	readonly suffix: string;
	readonly note: string;
}

export interface SyncTool {
	readonly id: string;
	emittedPath?(source: string): string;
	readsOnly?(source: string): boolean;
	readonly initName?: string;
	readonly runtimeFolder?: string;
	readonly cacheFiles?: readonly string[];
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
		readonly shared: string,
		readonly server: string
	) {}

	mounts(installedDirs: ReadonlySet<string>): Mount[] {
		return [
			{ path: this.shared, landing: PackageManager.SHARED_LANDING },
			{ path: this.server, landing: PackageManager.SERVER_LANDING },
		].filter(({ path }) => installedDirs.has(path));
	}
}

interface PlannedFileFields {
	readonly fileName: string;
	readonly content: string;
}

interface PlannedNewFile extends PlannedFileFields {
	readonly addition?: undefined;
}

interface PlannedAdditionToExistingFile extends PlannedFileFields {
	readonly addition: string;
}

export type PlannedFile = PlannedNewFile | PlannedAdditionToExistingFile;

export interface Mount {
	readonly path: string;
	readonly landing: string;
}

export interface Compiler {
	readonly name: string;
	readonly outDir: string;
	readonly compileCommand: string;
}

export interface LanguageCopy {
	readonly label: string;
	readonly detectedHint?: string;
}

export type LanguageId = "luau" | "roblox-ts";

export interface Language {
	readonly id: LanguageId;
	readonly copy: LanguageCopy;
	readonly extension: string;
	readonly defaultPackageManager?: PackageManager;
	readonly compiler?: Compiler;
	readonly present: boolean;
	readonly reservedFolders: readonly string[];

	scaffolded?(): Language;
	routeKey(id: string): string;
	configuredSourcePath(): string | undefined;
	mounts(): readonly Mount[];
}

export interface LanguageDetector {
	detect(cwd: string): Promise<Language>;
}

interface DetectedWorkspaceFields {
	readonly fallbackLanguage: Language;
	readonly otherLanguages: readonly Language[];
	readonly darkluaConfig?: string;
	readonly packageManager?: PackageManager;
	readonly packageDirs: ReadonlySet<string>;
	readonly testRunner?: string;
}

export class DetectedWorkspace {
	private readonly fallbackLanguage: Language;
	readonly languages: readonly Language[];
	readonly darkluaConfig?: string;
	readonly packageManager?: PackageManager;
	readonly packageDirs: ReadonlySet<string>;
	readonly testRunner?: string;

	constructor(fields: DetectedWorkspaceFields) {
		this.fallbackLanguage = fields.fallbackLanguage;
		this.languages = [fields.fallbackLanguage, ...fields.otherLanguages];
		this.darkluaConfig = fields.darkluaConfig;
		this.packageManager = fields.packageManager;
		this.packageDirs = fields.packageDirs;
		this.testRunner = fields.testRunner;
	}

	get language(): Language {
		return (
			this.languages.find(({ present }) => present) ??
			this.fallbackLanguage
		);
	}

	languageFor(id: LanguageId): Language {
		const language = this.languages.find(
			(candidate) => candidate.id === id
		);
		if (!language) throw new Error(`Language "${id}" is not registered.`);
		return language;
	}

	packageMounts(language: Language): Mount[] {
		const manager = this.packageManager ?? language.defaultPackageManager;
		return manager?.mounts(this.packageDirs) ?? [];
	}
}

export class Darklua {
	static readonly SYNC_TOOL: SyncTool = {
		id: "darklua",
		metaReplacement: {
			suffix: ".meta.lua",
			note: "Darklua converts every .meta.json.",
		},
		dataReplacement: {
			suffix: ".lua",
			note: "Darklua converts data files and can't copy them.",
		},
	};

	static readonly CONFIG_FILES: readonly string[] = [
		".darklua.json",
		".darklua.json5",
	];
}
