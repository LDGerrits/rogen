import path from "path";
import { isInside, samePath } from "../../base/path.js";
import { ProjectText, WrittenTree } from "../rojo/project-text.js";
import {
	RojoNode,
	isProjectFileName,
	projectFileName,
} from "../rojo/rojo-project.js";

/** The key that holds Rogen's own keys; the top level is Rojo's. */
export const ROGEN_BLOCK = "rogen";

/** The keys Rogen adds to a Rojo project file, which sit in the `rogen` block. */
export interface RogenKeys {
	readonly sourcePaths?: string[];
	readonly routes?: Record<string, string>;
	readonly compiledPath?: string;
}

/** What a `.rogen.json` holds: a Rojo project file, plus a `rogen` block of the keys Rogen reads. */
export interface RogenConfig {
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
	readonly rogen?: RogenKeys;
}

interface ConfigValues {
	getValue<T>(section?: string | readonly string[]): T | undefined;
}

/** A key of the `rogen` block. */
export function fieldOf<K extends keyof RogenKeys>(
	values: ConfigValues,
	key: K
): RogenKeys[K] {
	return values.getValue<RogenKeys[K]>(["rogen", key]);
}

const CONFIG_FILE_PATTERN = /^(.+)\.rogen\.jsonc?$/;

/** The stem of a config file's name: `dist` for `dist.rogen.json`. */
export const configStem = (fileName: string): string | undefined =>
	CONFIG_FILE_PATTERN.exec(path.basename(fileName))?.[1];

export const isConfigFileName = (fileName: string): boolean =>
	configStem(fileName) !== undefined;

/** The stem of the project file a config writes when it is named `default`. */
export const DEFAULT_PROJECT = "default";

/** The name of the config file for the project file `stem`: `dist.rogen.json` for `dist`. */
export const configFileName = (stem: string): string => `${stem}.rogen.json`;

export const DEFAULT_CONFIG_FILE = configFileName(DEFAULT_PROJECT);

/** The stem of a project file's name: `dist` for `dist.project.json`. */
export const projectStem = (projectFile: string): string =>
	path.basename(projectFile).replace(/\.project\.jsonc?$/, "");

/** A folder's default config, in either extension. */
export const DEFAULT_CONFIG_FILE_NAMES: readonly string[] = [
	DEFAULT_CONFIG_FILE,
	`${DEFAULT_CONFIG_FILE}c`,
];

export const isDefaultConfigFileName = (fileName: string): boolean =>
	DEFAULT_CONFIG_FILE_NAMES.includes(fileName);

/** The names a folder's config had before configs were named for the project file they write. */
export const LEGACY_CONFIG_FILE_NAMES: readonly string[] = [
	"rogen.json",
	"rogen.jsonc",
];

/** What `rogen syncback` writes beside a config while it runs: the project file Rojo reads, and the folder it writes new instances into. */
export const SYNCBACK_FILES = {
	project: "rogen-syncback.project.json",
	staging: ".rogen-syncback",
} as const;

export const isSyncbackFileName = (name: string): boolean =>
	name === SYNCBACK_FILES.project || name === SYNCBACK_FILES.staging;

/** The folder Rogen scans when a config declares routes and no source paths. */
export const DEFAULT_SOURCE_PATH = "src";

/** The source paths a config without `sourcePaths` has: the default folder when it has routes to scan it, else none. */
export function defaultSourcePaths(routed: boolean): string[] {
	return routed ? [DEFAULT_SOURCE_PATH] : [];
}

export const DEFAULT_PROJECT_FILE = projectFileName(DEFAULT_PROJECT);

/** The names Rojo looks for in a folder, in its order. */
export const DEFAULT_PROJECT_FILES = [
	DEFAULT_PROJECT_FILE,
	`${DEFAULT_PROJECT_FILE}c`,
];

/** Whether a file is named as a Rojo project file is. A config that is one was given no `.rogen.json`, and is its own output. */
export const isProjectFileConfig = (file: string): boolean =>
	isProjectFileName(path.basename(file));

/** Whether Rojo reads this project file without a `name`, as it names the project after the folder. */
export const isDefaultProjectFile = (file: string): boolean =>
	DEFAULT_PROJECT_FILES.includes(path.basename(file));

/** The keys of the `rogen` block, in the order `rogen fmt-project` writes them. */
export const ROGEN_KEYS: readonly (keyof RogenKeys)[] = [
	"sourcePaths",
	"routes",
	"compiledPath",
];

/** A config as `rogen fmt-project` writes it, so the first format changes nothing. */
function configText(
	config: Record<string, unknown>,
	written?: WrittenTree
): string {
	return ProjectText.ofConfig(config, ROGEN_KEYS, written);
}

/** `written`: the tree of the project file the config was lifted from, which stays as the user wrote it where it is unchanged. */
export function configFileContent(
	config: RogenConfig,
	written?: WrittenTree
): string {
	return configText({ ...config }, written);
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
