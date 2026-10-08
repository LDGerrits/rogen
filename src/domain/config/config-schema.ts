import { JSONSchema } from "../../base/json-schema.js";
import {
	ConfigModel,
	MergePolicies,
	MergePolicy,
} from "../../platform/config/config-models.js";
import { RogenConfig } from "./config.js";

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

const variantsSchema: JSONSchema = {
	type: "object",
	default: {},
	description:
		"Every variant this project uses, and whether it is on in this config. " +
		"A standalone config must know the whole declared set, or an " +
		"undeclared variant ships silently as part of an instance name.",
	additionalProperties: { type: "boolean" },
};

interface ConfigField {
	readonly schema: JSONSchema;
	/** How a child's value combines with its parent's across `extends`. */
	readonly merge: MergePolicy;
}

/** One entry per field of a config file, so a field can't be added without saying how it merges. */
const fields: Record<keyof RogenConfig, ConfigField> = {
	$schema: {
		merge: "replace",
		schema: {
			type: "string",
			description: "The published JSON Schema URI for editor validation.",
		},
	},
	extends: {
		merge: "replace",
		schema: {
			type: "string",
			description:
				"Another *.rogen.json to inherit from, relative to this file.",
		},
	},
	rootDirs: {
		merge: "append",
		schema: {
			type: "array",
			items: { type: "string" },
			default: ["src"],
			description:
				"Directories Rogen scans and watches, merged into one tree; " +
				"the last wins on a clash. A config adds its entries to those " +
				'of the config it extends; "src" applies only when no config ' +
				"in the chain sets any.",
		},
	},
	routes: { merge: "merge", schema: routesSchema },
	variants: { merge: "merge", schema: variantsSchema },
	exclude: {
		merge: "append",
		schema: {
			type: "array",
			items: { type: "string" },
			default: [],
			description:
				"Globs never built, relative to this file's directory. A " +
				"config adds its globs to those of the config it extends.",
		},
	},
	template: {
		merge: "replace",
		schema: {
			type: "string",
			description:
				"A Rojo project file whose tree Rogen merges its generated " +
				"nodes into.",
		},
	},
	syncDir: {
		merge: "replace",
		schema: {
			type: "string",
			description:
				"The directory Rojo syncs from, when that isn't your root " +
				"dirs. Set it to your compiler's output directory - " +
				'"out" for roblox-ts, "dist" for Darklua. Leave it out for ' +
				"plain Luau.",
		},
	},
	outFile: {
		merge: "replace",
		schema: {
			type: "string",
			description:
				"The Rojo project file Rogen writes. Defaults to this " +
				"config's own file name, with .rogen.json replaced by " +
				".project.json.",
		},
	},
};

/** How each top-level field combines across a config's chain. */
export const configMergePolicies: MergePolicies = Object.fromEntries(
	Object.entries(fields).map(([key, field]) => [key, field.merge])
);

/** What a `*.rogen.json` may hold; a key outside it is an error. */
export const configSchema: JSONSchema = {
	type: "object",
	additionalProperties: false,
	properties: Object.fromEntries(
		Object.entries(fields).map(([key, field]) => [key, field.schema])
	),
};

/** The values a config has before any file or flag sets them. */
export const configDefaults = new ConfigModel(
	Object.fromEntries(
		Object.entries(configSchema.properties ?? {}).flatMap(
			([key, schema]) =>
				schema.default === undefined ? [] : [[key, schema.default]]
		)
	)
);
