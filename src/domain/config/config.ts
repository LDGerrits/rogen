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

/** Anything that holds config values by field name, such as a config model. */
interface ConfigValues {
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
export const ROOT_ONLY_KEYS: readonly string[] = [
	"projects",
	"serveProject",
	"placePaths",
];

/** The port the first place without a `servePort` is served on, which is Rojo's own default. */
export const FIRST_PLACE_PORT = 34872;

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
type SourcePathOverlap =
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
