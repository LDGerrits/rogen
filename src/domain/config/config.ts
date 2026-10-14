import path from "path";
import { formatJsonFile } from "../../base/json.js";
import { commonAncestor, isInside, samePath } from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { Target } from "../roblox/roblox.js";
import {
	ParsedProjectFile,
	RojoNode,
	RojoProject,
	projectFileName,
} from "../rojo/rojo-project.js";

/** What a project of a `rogen.json` may change: any key of the description. `null` removes a key. */
export type ProjectChanges = Partial<
	Omit<RogenConfig, "$schema" | "projects" | "serveProject">
>;

/** What a `rogen.json` holds: a Rojo project file, plus the keys Rogen reads. */
export interface RogenConfig {
	readonly $schema?: string;
	readonly name?: string;
	readonly tree?: RojoNode;
	readonly servePort?: number;
	readonly serveAddress?: string;
	readonly serveAllowedHosts?: string[];
	readonly servePlaceIds?: number[];
	readonly blockedPlaceIds?: number[];
	readonly placeId?: number;
	readonly gameId?: number;
	readonly emitLegacyScripts?: boolean;
	readonly globIgnorePaths?: string[];
	readonly syncRules?: unknown[];
	readonly syncbackRules?: Record<string, unknown>;
	readonly sourcePaths?: string[];
	readonly routes?: Record<string, string>;
	readonly syncPath?: string;
	readonly projects?: Record<string, ProjectChanges>;
	readonly serveProject?: string;
}

/** Anything that holds config values by field name, such as a config model. */
export interface ConfigValues {
	getValue<T>(section?: string | readonly string[]): T | undefined;
}

/** What `values` holds under the top-level field `key`, typed as the config declares it. */
export function fieldOf<K extends keyof RogenConfig>(
	values: ConfigValues,
	key: K
): RogenConfig[K] {
	return values.getValue<RogenConfig[K]>(key);
}

/** The file names a folder's config goes by. */
export const CONFIG_FILE_NAMES: readonly string[] = [
	"rogen.json",
	"rogen.jsonc",
];

/** The config a folder starts with. */
export const DEFAULT_CONFIG_FILE = "rogen.json";

/** Whether `fileName` is the name of a config file. */
export const isConfigFileName = (fileName: string): boolean =>
	CONFIG_FILE_NAMES.includes(fileName);

/** The name a config is asked for by: its folder's. */
export const configLabel = (file: string): string =>
	path.basename(path.dirname(file));

/** The folder Rogen scans when a config declares routes and no source paths. */
export const DEFAULT_SOURCE_PATH = "src";

/** The project that is the description itself, which no entry of `projects` may take the name of. */
export const DEFAULT_PROJECT = "default";

/** The project file a folder's config writes beside itself. */
export const DEFAULT_PROJECT_FILE = projectFileName(DEFAULT_PROJECT);

/** The keys that stand for the whole config, which a project can't change. */
export const ROOT_ONLY_KEYS: readonly string[] = ["projects", "serveProject"];

/** What a project's name may be, since the name is the stem of the file written. */
export const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const SCHEMA_BASE_URL = "https://ldgerrits.github.io/rogen/schema";

/** The schema a config written by this release points at. */
export const SCHEMA_URL = schemaUrlFor("2.0.0-beta.1");

/** Where a release's configs point: its major, except a pre-release of a later minor or patch, which may add fields its major doesn't have yet. */
export function schemaChannel(version: string): string {
	const exact = version.includes("-") && !/^\d+\.0\.0-/.test(version);
	return exact ? version : version.split(".")[0];
}

export function schemaUrlFor(version: string): string {
	return `${SCHEMA_BASE_URL}/${schemaChannel(version)}/rogen.json`;
}

/** The schema a project file written by this release points at. */
export const PROJECT_SCHEMA_URL = SCHEMA_URL.replace(/[^/]+$/, "project.json");

/** A config file's text as Rogen writes one: strict JSON that points at this release's schema. */
export function configFileContent(config: RogenConfig): string {
	return formatJsonFile({ $schema: SCHEMA_URL, ...config });
}

/** How a source path overlaps another of `sourcePaths`; a file under both would belong to both. */
export type SourcePathOverlap =
	| { readonly kind: "duplicate" }
	| { readonly kind: "nested"; readonly outer: string };

/** How the source path at `index` overlaps an earlier or enclosing one, if it does. All paths absolute. */
export function sourcePathOverlap(
	sourcePaths: readonly string[],
	index: number
): SourcePathOverlap | undefined {
	const sourcePath = sourcePaths[index];
	const first = sourcePaths.findIndex((other) => samePath(other, sourcePath));
	if (first !== index) return { kind: "duplicate" };
	const outer = sourcePaths.find((other) => isInside(sourcePath, other));
	return outer === undefined ? undefined : { kind: "nested", outer };
}

/** The route keys a config declares; a name spells a key exactly or with its first letter flipped. */
export class DeclaredKeys {
	/** The route that takes every file no other route claims. */
	static readonly FALLBACK_ROUTE = "*";

	static readonly NAME = /^[A-Za-z][A-Za-z0-9]*$/;

	/** Every route key but the fallback, which no name can spell. */
	readonly routeKeys: ReadonlySet<string>;

	constructor(routeKeys: Iterable<string>) {
		this.routeKeys = new Set(
			[...routeKeys].filter((key) => key !== DeclaredKeys.FALLBACK_ROUTE)
		);
	}

	/** Whether `text` can be a key: letters and digits, starting with a letter. */
	static isName(text: string): boolean {
		return DeclaredKeys.NAME.test(text);
	}

	/** Keys that share this identity match the same names. */
	static identityOf(key: string): string {
		return key.slice(0, 1).toLowerCase() + key.slice(1);
	}

	/** The same name with the first letter in the other case. */
	static flipFirstLetter(name: string): string {
		const first = name[0];
		const flipped =
			first === first.toLowerCase()
				? first.toUpperCase()
				: first.toLowerCase();
		return flipped + name.slice(1);
	}

	isRoute(key: string): boolean {
		return this.routeKeys.has(key);
	}

	/** The key `name` spells, exactly or with the first letter in the other case. */
	resolve(name: string): string | undefined {
		return this.resolveIn(name, this.routeKeys);
	}

	/** The key `name` only differs from beyond the first letter's case, when `name` doesn't spell a key. */
	nearMiss(name: string): string | undefined {
		if (this.resolve(name) !== undefined) return undefined;
		const lower = name.toLowerCase();
		return [...this.routeKeys].find((key) => key.toLowerCase() === lower);
	}

	private resolveIn(
		name: string,
		keys: ReadonlySet<string>
	): string | undefined {
		if (name === "") return undefined;
		if (keys.has(name)) return name;
		const flipped = DeclaredKeys.flipFirstLetter(name);
		return keys.has(flipped) ? flipped : undefined;
	}
}

export interface ResolvedConfigFields {
	/** The config file itself. */
	readonly file: string;
	/** The project this describes: `default`, or the name of an entry of `projects`. */
	readonly stem: string;
	/** The project `rogen serve` serves when none is named. */
	readonly serveProject: string;
	/** The name Rojo and Rogen know the project by: the file's `name`, else its folder's. */
	readonly projectName: string;
	/** The Rojo project file the config describes, its tree as the user wrote it and the keys Rogen doesn't read passed through. Every `$path` and glob is relative to the config's folder. */
	readonly project: RojoProject<ParsedProjectFile>;
	/** Absolute. */
	readonly sourcePaths: readonly string[];
	/** In declaration order. */
	readonly routes: ReadonlyMap<string, Target>;
	/** `globIgnorePaths` as globs on absolute POSIX paths, which keep scanned files out of routing. */
	readonly ignored: readonly string[];
	/** Absolute. */
	readonly syncPath?: string;
	/** What the config says that is no error: a key Rojo will reject in the written file. */
	readonly warnings: readonly Diagnostic[];
}

/** A config with its values validated: every path is absolute and every route target is parsed. */
export class ResolvedConfig {
	readonly file: string;
	readonly stem: string;
	readonly serveProject: string;
	readonly projectName: string;
	readonly project: RojoProject<ParsedProjectFile>;
	readonly sourcePaths: readonly string[];
	readonly routes: ReadonlyMap<string, Target>;
	readonly ignored: readonly string[];
	readonly syncPath?: string;
	readonly warnings: readonly Diagnostic[];
	readonly keys: DeclaredKeys;

	constructor(fields: ResolvedConfigFields) {
		this.file = fields.file;
		this.stem = fields.stem;
		this.serveProject = fields.serveProject;
		this.projectName = fields.projectName;
		this.project = fields.project;
		this.sourcePaths = fields.sourcePaths;
		this.routes = fields.routes;
		this.ignored = fields.ignored;
		this.syncPath = fields.syncPath;
		this.warnings = fields.warnings;
		this.keys = new DeclaredKeys(fields.routes.keys());
	}

	/** What the project is asked for by: the name of the game, and for a project of the config its own name beside it. */
	get label(): string {
		return this.stem === DEFAULT_PROJECT
			? this.projectName
			: `${this.projectName} (${this.stem})`;
	}

	/** What tells this project from every other that is served or built: the config it is read from, and its name there. */
	get id(): string {
		return `${this.file}#${this.stem}`;
	}

	/** Whether this is the description itself, not an entry of `projects`. */
	get isDefault(): boolean {
		return this.stem === DEFAULT_PROJECT;
	}

	/** The directory the project file is written to, and every path in it is relative to. */
	get projectDir(): string {
		return path.dirname(this.file);
	}

	/** The project file the project is written to. */
	get projectFile(): string {
		return path.join(this.projectDir, projectFileName(this.stem));
	}

	/** The folders a build lists: its source paths, else the folder it would have scanned by default, to find files nothing mounts. */
	get indexedPaths(): readonly string[] {
		return this.routes.size > 0
			? this.sourcePaths
			: [path.join(this.projectDir, DEFAULT_SOURCE_PATH)];
	}

	/** The deepest directory holding every source path, or `undefined` without any. */
	get commonRoot(): string | undefined {
		return this.sourcePaths.length > 0
			? commonAncestor(this.sourcePaths)
			: undefined;
	}
}

/** A `rogen.json` resolved: the description, and the projects it writes beside it. */
export interface ResolvedConfigFile {
	/** The description itself, written as `default.project.json`. */
	readonly config: ResolvedConfig;
	/** The entries of `projects`, in the order they are declared. */
	readonly projects: readonly ResolvedConfig[];
}

/** Every project a resolved config file writes, the description first. */
export const projectsOf = (resolved: ResolvedConfigFile): ResolvedConfig[] => [
	resolved.config,
	...resolved.projects,
];
