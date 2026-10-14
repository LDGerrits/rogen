import path from "path";
import { formatJsonFile } from "../../base/json.js";
import { isInside, samePath } from "../../base/path.js";
import { RojoNode, projectFileName } from "../rojo/rojo-project.js";

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
	readonly placePaths?: string[];
}

/** Keys a place has of its own and never inherits from its config. */
export const PLACE_OWN_KEYS = ["name", "sourcePaths"] as const;

type Inherited = Exclude<
	keyof RogenConfig,
	| (typeof PLACE_OWN_KEYS)[number]
	| "$schema"
	| (typeof ROOT_ONLY_KEYS)[number]
>;

/** What a place's `rogen.json` holds: a config's keys, `null` removing one the place inherits. */
export type PlaceConfig = Omit<RogenConfig, Inherited> & {
	readonly [K in Inherited]?: RogenConfig[K] | null;
};

interface ConfigValues {
	getValue<T>(section?: string | readonly string[]): T | undefined;
}

export function fieldOf<K extends keyof RogenConfig>(
	values: ConfigValues,
	key: K
): RogenConfig[K] {
	return values.getValue<RogenConfig[K]>(key);
}

export const CONFIG_FILE_NAMES: readonly string[] = [
	"rogen.json",
	"rogen.jsonc",
];

export const DEFAULT_CONFIG_FILE = "rogen.json";

export const isConfigFileName = (fileName: string): boolean =>
	CONFIG_FILE_NAMES.includes(fileName);

/** The name a config is asked for by: its folder's. */
export const configLabel = (file: string): string =>
	path.basename(path.dirname(file));

/** The folder Rogen scans when a config declares routes and no source paths. */
export const DEFAULT_SOURCE_PATH = "src";

/** The project that is the description itself, which no entry of `projects` may take the name of. */
export const DEFAULT_PROJECT = "default";

export const DEFAULT_PROJECT_FILE = projectFileName(DEFAULT_PROJECT);

export const ROOT_ONLY_KEYS = [
	"projects",
	"serveProject",
	"placePaths",
] as const;

export const isRootOnlyKey = (key: string): boolean =>
	(ROOT_ONLY_KEYS as readonly string[]).includes(key);

export const isPlaceOwnKey = (key: string): boolean =>
	(PLACE_OWN_KEYS as readonly string[]).includes(key);

/** Rojo's default port, given to the first place without a `servePort`. */
export const FIRST_PLACE_PORT = 34872;

export const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const SCHEMA_BASE_URL = "https://ldgerrits.github.io/rogen/schema";

export const SCHEMA_URL = schemaUrlFor("2.0.0-beta.1");

/** A release's schema channel: its major, or the exact version of a pre-release that is not x.0.0-. */
export function schemaChannel(version: string): string {
	const exact = version.includes("-") && !/^\d+\.0\.0-/.test(version);
	return exact ? version : version.split(".")[0];
}

export function schemaUrlFor(version: string): string {
	return `${SCHEMA_BASE_URL}/${schemaChannel(version)}/rogen.json`;
}

export function configFileContent(config: PlaceConfig): string {
	return formatJsonFile({ $schema: SCHEMA_URL, ...config });
}

type SourcePathOverlap =
	| { readonly kind: "duplicate" }
	| { readonly kind: "nested"; readonly outer: string };

/** How the source path at `index` overlaps an earlier or enclosing one. Paths are absolute. */
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
