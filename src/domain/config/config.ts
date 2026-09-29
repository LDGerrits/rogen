import path from "path";
import { JSONSchema } from "../../base/json-schema.js";
import { isInside } from "../../base/path.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	Extensions,
	ConfigRegistry,
} from "../../platform/config/config-registry.js";
import { RojoTree } from "../rojo/rojo-tree.js";

export interface RogenConfig {
	readonly $schema?: string;
	readonly extends?: string;
	readonly rootDirs?: string[];
	readonly routes?: Record<string, string>;
	readonly tags?: Record<string, boolean>;
	readonly exclude?: string[];
	readonly template?: string;
	readonly syncDir?: string;
	readonly outFile?: string;
}

export interface ResolvedTemplate {
	readonly file: string;
	readonly project: Partial<RojoTree>;
}

export interface ResolvedConfig {
	/** The config file itself, the leaf of its `extends` chain. */
	readonly file: string;
	readonly name: string;
	readonly rootDirs: string[];
	readonly routes: Record<string, string>;
	readonly tags: Record<string, boolean>;
	readonly exclude: string[];
	readonly template?: ResolvedTemplate;
	readonly syncDir?: string;
	readonly outFile: string;
}

export const CONFIG_SUFFIX = ".rogen.json";
export const DEFAULT_CONFIG_STEM = "default";

export const configFileName = (stem: string): string =>
	`${stem}${CONFIG_SUFFIX}`;

/** The name a config is asked for by, e.g. `lobby` for `lobby.rogen.json`. */
export const configLabel = (file: string): string =>
	path.basename(file, CONFIG_SUFFIX);

/** The root dir among `rootDirs` that `rootDir` sits inside, if any; a file under both would belong to both. All paths absolute. */
export function outerRootDir(
	rootDir: string,
	rootDirs: readonly string[]
): string | undefined {
	return rootDirs.find(
		(other) => other !== rootDir && isInside(rootDir, other)
	);
}

const SCHEMA_BASE_URL = "https://ldgerrits.github.io/rogen/schema";

const isPrerelease = (version: string): boolean => version.includes("-");

const versionParts = (version: string): number[] =>
	version.split(".").map(Number);

const majorOf = (version: string): string => version.split(".")[0];

/** Compares stable versions numerically, so 2.10.0 sorts after 2.9.0. */
function compareVersions(a: string, b: string): number {
	const [left, right] = [versionParts(a), versionParts(b)];
	for (let i = 0; i < 3; i++) {
		const difference = (left[i] ?? 0) - (right[i] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

/**
 * The paths a release publishes to. A pre-release only gets its exact version,
 * so a breaking change can't reach stable users. An alias is skipped when a
 * newer stable release is already published, so a late patch to an older line
 * can't roll it back.
 */
export function schemaChannels(
	version: string,
	published: readonly string[] = []
): readonly string[] {
	if (isPrerelease(version)) return [version];

	const newer = published.filter(
		(other) => !isPrerelease(other) && compareVersions(other, version) > 0
	);
	const major = majorOf(version);
	return [
		version,
		...(newer.some((other) => majorOf(other) === major) ? [] : [major]),
		...(newer.length > 0 ? [] : ["latest"]),
	];
}

export function schemaUrlFor(version: string): string {
	const channel = isPrerelease(version) ? version : majorOf(version);
	return `${SCHEMA_BASE_URL}/${channel}/rogen.json`;
}

const registry = Registry.as<ConfigRegistry>(Extensions.Config);

const routesSchema: JSONSchema = {
	type: "object",
	default: {},
	description:
		'Route key -> "Service" or "Service/Folder/...", where Service is ' +
		"any service Rojo can write to, such as ServerScriptService or " +
		"ReplicatedStorage. Only declared " +
		"keys route: there is no built-in set, so an absent or empty " +
		"routes leaves every file unrouted (rogen init writes a starting set).",
	additionalProperties: { type: "string" },
};

const tagsSchema: JSONSchema = {
	type: "object",
	default: {},
	description:
		"Every tag this project uses, and whether it is on in this config. " +
		"A standalone config must know the whole declared set, or an " +
		"undeclared suffix ships silently as part of an instance name.",
	additionalProperties: { type: "boolean" },
};

registry.registerConfig({
	id: "rogen.core",
	title: "Rogen configuration",
	type: "object",
	properties: {
		$schema: {
			type: "string",
			description: "The published JSON Schema URI for editor validation.",
		},
		extends: {
			type: "string",
			description:
				"Another *.rogen.json to inherit from, relative to this file.",
		},
		rootDirs: {
			type: "array",
			items: { type: "string" },
			default: ["src"],
			description:
				"Directories Rogen scans and watches, merged into one tree; " +
				"the last wins on a clash.",
		},
		routes: routesSchema,
		tags: tagsSchema,
		exclude: {
			type: "array",
			items: { type: "string" },
			default: [],
			description:
				"Globs never built, relative to this file's directory.",
		},
		template: {
			type: "string",
			description:
				"A Rojo project file whose tree Rogen merges its generated " +
				"nodes into.",
		},
		syncDir: {
			type: "string",
			description:
				"The directory Rojo syncs from, when that isn't your root " +
				"dirs. Set it to your compiler's output directory - " +
				'"out" for roblox-ts, "dist" for Darklua. Leave it out for ' +
				"plain Luau.",
		},
		outFile: {
			type: "string",
			description:
				"The Rojo project file Rogen writes. Defaults to this " +
				"config's own file name, with .rogen.json replaced by " +
				".project.json.",
		},
	},
});
