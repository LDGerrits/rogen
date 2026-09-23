import { JSONSchema } from "../../base/json-schema.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	Extensions,
	ConfigRegistry,
} from "../../platform/config/config-registry.js";

export const SUPPORTED_SERVICES = [
	"ServerScriptService",
	"ServerStorage",
	"ReplicatedStorage",
	"ReplicatedFirst",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"Workspace",
	"Lighting",
	"SoundService",
	"RobloxPluginGuiService",
] as const;

export type SupportedService = (typeof SUPPORTED_SERVICES)[number];

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

export interface CollapsedConfig {
	readonly file: string;
	readonly chain: readonly string[];
	readonly rootDirs?: readonly string[];
	readonly routes?: Readonly<Record<string, string>>;
	readonly tags?: Readonly<Record<string, boolean>>;
	readonly exclude?: readonly string[];
	readonly template?: string;
	readonly syncDir?: string;
	readonly outFile?: string;
}

export interface ResolvedConfig {
	readonly rootDirs: string[];
	readonly routes: Record<string, string>;
	readonly tags: Record<string, boolean>;
	readonly exclude: string[];
	readonly template?: string;
	readonly syncDir?: string;
	readonly outFile: string;
}

const registry = Registry.as<ConfigRegistry>(Extensions.Config);

const routesSchema: JSONSchema = {
	type: "object",
	default: {},
	description:
		'Route key -> "Service" or "Service/Folder/...". Only declared ' +
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
