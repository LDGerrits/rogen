import { Disposable } from "../../base/disposable.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Registry } from "../../platform/registry/registry.js";

export type PackageManager = "wally" | "pesde";

/** Where a repo that builds several places keeps each place's own code. */
export const PLACES_DIR = "places";

/**
 * What `init` found in the workspace: facts only, never decisions. A
 * language fills the facts it reads itself, and only that language reads them.
 */
export interface DetectedWorkspace {
	/** The detected language's id, or the first language's when none was found. */
	readonly language: string;
	readonly darklua: boolean;
	readonly packageManager?: PackageManager;
	/** The installed package directories, of any manager. */
	readonly packageDirs: ReadonlySet<string>;
	/** Top-level folders holding Luau or TypeScript code, sorted. */
	readonly codeFolders: readonly string[];
	readonly hasSrc: boolean;
	/** The folders directly inside `places/`, sorted. */
	readonly places: readonly string[];
	/** roblox-ts: `compilerOptions.outDir`, when tsconfig.json exists. */
	readonly outDir?: string;
	/** roblox-ts: `compilerOptions.rootDir`. */
	readonly rootDir?: string;
	/** roblox-ts: whether tsconfig.json sets `include`. */
	readonly tsconfigHasInclude?: boolean;
	/** roblox-ts: `compilerOptions.tsBuildInfoFile`. */
	readonly tsBuildInfoFile?: string;
	/** roblox-ts: the installed package scopes under `node_modules`. */
	readonly rbxtsScopes?: readonly string[];
	/** roblox-ts: whether the runtime's `include` folder exists. */
	readonly hasInclude?: boolean;
}

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

export interface LanguageDetection {
	/** Whether the workspace uses this language. */
	readonly present: boolean;
	/** The facts this language reads, whether or not it's present: the user may still pick it. */
	readonly facts: Partial<DetectedWorkspace>;
	/** Top-level folders holding the language's own files, never offered as code folders. */
	readonly reservedFolders: readonly string[];
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
	readonly workspace: DetectedWorkspace;
}

/** A compile step between the root dirs and what Rojo syncs, as roblox-ts has. */
export interface Compiler {
	/** Names the compiler in notes, such as "Syncing from out, where roblox-ts compiles to." */
	readonly name: string;
	/** Where it writes, and so what Rojo or a processor reads instead of the root dirs. */
	outDir(workspace: DetectedWorkspace): string;
	/** Where it writes when its own config doesn't say. */
	readonly defaultOutDir: string;
	/** The long-running compile, which keeps its own terminal busy. */
	readonly compileCommand: string;
	/** A compiler reads one root dir; this explains it in the root dir question. */
	readonly rootDirDescription: string;
	/** The answer to the root dir question when several were given. */
	readonly severalRootDirs: string;
	/** The files a place named `name` adds, beside its config and project file. */
	placeFileNames(name: string): readonly string[];
	planPlace(request: CompilerPlaceRequest): CompiledPlace;
}

/**
 * A language `init` can set up. Everything that differs between Luau and
 * roblox-ts is answered here, so the planner never names a language.
 */
export interface Language {
	readonly id: string;
	/** As the language question shows it. */
	readonly label: string;
	/** Where the language question lists it; the first is also the one assumed when none is detected. */
	readonly order: number;
	/** The script extension written in examples, such as `Analytics.mock.luau`. */
	readonly extension: string;
	/** The language question's hint when this language was detected. */
	readonly detectedHint?: string;
	/** The package manager offered when the workspace has none. */
	readonly defaultPackageManager?: PackageManager;
	/** Added to the packages question's description. */
	readonly packagesNote?: string;
	/** Set when code is compiled before Rojo syncs it. */
	readonly compiler?: Compiler;

	detect(
		fileSystem: FileSystemService,
		cwd: string
	): Promise<LanguageDetection>;
	/** How a route key is spelled, such as Luau's `Server` or roblox-ts's `server`. */
	routeKey(id: string): string;
	/** The root dir the language's own config names, if any; `init` prefers it. */
	configuredRootDir(workspace: DetectedWorkspace): string | undefined;
	/** Folders mounted without asking. */
	alwaysMounted(workspace: DetectedWorkspace): readonly MountCandidate[];
	/** Folders the packages question offers beside the package manager's. */
	offeredMounts(workspace: DetectedWorkspace): readonly MountCandidate[];
}

export interface LanguageRegistry {
	/** @throws Error if `language.id` is already registered. */
	registerLanguage(language: Language): Disposable;
	getLanguage(id: string): Language | undefined;
	/** Every registered language, in `order`. */
	getLanguages(): readonly Language[];
}

class CoreLanguageRegistry implements LanguageRegistry {
	private readonly languages = new Map<string, Language>();

	registerLanguage(language: Language): Disposable {
		if (this.languages.has(language.id)) {
			throw new Error(`Language "${language.id}" is already registered.`);
		}
		this.languages.set(language.id, language);
		return {
			[Symbol.dispose]: () => {
				if (this.languages.get(language.id) === language) {
					this.languages.delete(language.id);
				}
			},
		};
	}

	getLanguage(id: string): Language | undefined {
		return this.languages.get(id);
	}

	getLanguages(): readonly Language[] {
		return [...this.languages.values()].sort((a, b) => a.order - b.order);
	}
}

export const Extensions = {
	Languages: "domain.contributions.languages",
};

Registry.add(Extensions.Languages, new CoreLanguageRegistry());
