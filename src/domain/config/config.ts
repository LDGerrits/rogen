import path from "path";
import { isInside, samePath } from "../../base/path.js";
import { ProjectText, WrittenTree } from "../rojo/project-text.js";
import {
	RojoNode,
	isProjectFileName,
	projectFileName,
} from "../rojo/rojo-project.js";

export interface RogenKeys {
	readonly sourcePaths?: string[];
	readonly routes?: Record<string, string>;
	readonly compiledPath?: string;
}

export interface RogenConfig extends RogenKeys {
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
}

const CONFIG_FILE_PATTERN = /^(.+)\.rogen\.jsonc?$/;

export const configStem = (fileName: string): string | undefined =>
	CONFIG_FILE_PATTERN.exec(path.basename(fileName))?.[1];

export const isConfigFileName = (fileName: string): boolean =>
	configStem(fileName) !== undefined;

export const DEFAULT_PROJECT = "default";

export const configFileName = (stem: string): string => `${stem}.rogen.json`;

export const DEFAULT_CONFIG_FILE = configFileName(DEFAULT_PROJECT);

export const projectStem = (projectFile: string): string =>
	path.basename(projectFile).replace(/\.project\.jsonc?$/, "");

export const DEFAULT_CONFIG_FILE_NAMES: readonly string[] = [
	DEFAULT_CONFIG_FILE,
	`${DEFAULT_CONFIG_FILE}c`,
];

export const isDefaultConfigFileName = (fileName: string): boolean =>
	DEFAULT_CONFIG_FILE_NAMES.includes(fileName);

export const SYNCBACK_FILES = {
	project: "rogen-syncback.project.json",
	staging: ".rogen-syncback",
} as const;

export const isSyncbackFileName = (name: string): boolean =>
	name === SYNCBACK_FILES.project || name === SYNCBACK_FILES.staging;

export const DEFAULT_SOURCE_PATH = "src";

export const DEFAULT_PROJECT_FILE = projectFileName(DEFAULT_PROJECT);

export const isProjectFileConfig = (file: string): boolean =>
	isProjectFileName(path.basename(file));

export const projectFileOf = (configFile: string): string =>
	isProjectFileConfig(configFile)
		? configFile
		: path.join(
				path.dirname(configFile),
				projectFileName(configStem(configFile)!)
			);

const COMPILER_STEM = "compiler";

export const compilerFileOf = (configFile: string): string => {
	const stem = configStem(configFile)!;
	return path.join(
		path.dirname(configFile),
		projectFileName(
			stem === DEFAULT_PROJECT
				? COMPILER_STEM
				: `${stem}.${COMPILER_STEM}`
		)
	);
};

export const isCompilerFileName = (name: string): boolean =>
	projectStem(name) === COMPILER_STEM ||
	projectStem(name).endsWith(`.${COMPILER_STEM}`);

export const ROGEN_KEYS: readonly (keyof RogenKeys)[] = [
	"sourcePaths",
	"routes",
	"compiledPath",
];

export const isRogenKey = (key: string): boolean =>
	(ROGEN_KEYS as readonly string[]).includes(key);

export function configFileContent(
	config: RogenConfig,
	written?: WrittenTree
): string {
	return ProjectText.ofConfig({ ...config }, ROGEN_KEYS, written);
}

type SourcePathOverlap =
	| { readonly kind: "duplicate" }
	| { readonly kind: "nested"; readonly outer: string };

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
