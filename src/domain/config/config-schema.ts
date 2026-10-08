import { JSONSchema } from "../../base/json-schema.js";
import { DOCS_URL } from "../../platform/product/product-service.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { WrongTypeAdvisor } from "../../platform/jsonc/jsonc-document-reader.js";
import {
	ConfigModel,
	MergePolicies,
	MergePolicy,
} from "../../platform/config/config-models.js";
import { SUPPORTED_SERVICES } from "../roblox/supported-services.js";
import { DeclaredKeys, RogenConfig } from "./config.js";

const NAME_PATTERN = DeclaredKeys.NAME.source;

const routesSchema: JSONSchema = {
	type: "object",
	default: {},
	description:
		'Route key -> "Service" or "Service/Folder/...", where Service is ' +
		"any service Rojo can write to, such as ServerScriptService or " +
		"ReplicatedStorage. Only declared " +
		"keys route: there is no built-in set, so an absent or empty " +
		"routes leaves every file unrouted (rogen init writes a starting set).",
	propertyNames: {
		pattern: `^(${NAME_PATTERN.slice(1, -1)}|\\${DeclaredKeys.FALLBACK_ROUTE})$`,
	},
	additionalProperties: {
		type: "string",
		pattern: `^(${SUPPORTED_SERVICES.join("|")})(/[^/]+)*$`,
		examples: [
			"ServerScriptService",
			"StarterPlayer/StarterPlayerScripts",
			"ReplicatedStorage/Shared",
			"ReplicatedFirst",
			"ServerStorage",
			"StarterGui",
		],
	},
};

const variantsSchema: JSONSchema = {
	type: "array",
	items: { type: "string", pattern: NAME_PATTERN },
	default: [],
	description:
		"Every variant this project uses. A variant is a switch: off unless " +
		"the active mode lists it or --variant turns it on. A declared name " +
		"marks files (Analytics.mock.luau, a mock folder, a .mock marker); " +
		"an undeclared one ships silently as part of an instance name.",
};

const conflictsSchema: JSONSchema = {
	type: "array",
	items: { type: "array", items: { type: "string" } },
	default: [],
	description:
		"Groups of declared variants of which at most one may be on, such as " +
		'[["halloween", "christmas"]]. A group names variants, never a mode.',
};

const modesSchema: JSONSchema = {
	type: "object",
	description:
		"Named environments, exactly one of which is active per build. A " +
		"mode marks files like a variant does (Service.prod.luau, a prod " +
		"folder, a .prod marker), turns variants on and excludes globs, " +
		'never changes where files go. "mode" or --mode picks the active one.',
	propertyNames: { pattern: NAME_PATTERN },
	additionalProperties: {
		type: "object",
		additionalProperties: false,
		properties: {
			variants: {
				type: "array",
				items: { type: "string" },
				description:
					"Variants this mode turns on. Each must be declared " +
					'under "variants".',
			},
			exclude: {
				type: "array",
				items: { type: "string" },
				description:
					"Globs left out in this mode, relative to this file's " +
					"directory, added to the config's own exclude.",
			},
		},
	},
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
	variants: { merge: "append", schema: variantsSchema },
	conflicts: { merge: "append", schema: conflictsSchema },
	modes: {
		merge: { each: { variants: "append", exclude: "append" } },
		schema: modesSchema,
	},
	mode: {
		merge: "replace",
		schema: {
			type: "string",
			pattern: NAME_PATTERN,
			description:
				'The mode this config builds in, unless --mode says otherwise. Required when "modes" is declared.',
		},
	},
	exclude: {
		merge: "append",
		schema: {
			type: "array",
			items: { type: "string" },
			default: [],
			description:
				"Globs never built, relative to this file's directory: " +
				"scanned files, and the template's mounts whose $path they " +
				"match. A config adds its globs to those of the config it " +
				"extends.",
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

const MODES_LINK = `${DOCS_URL}/core-concepts/modes`;
const MODE_VARIANTS_PATH = /^modes\.[^.]+\.variants$/;

/** The words for an old config that wrote `variants` as a map of on and off. */
export const configWrongTypeAdvice: WrongTypeAdvisor = (
	path,
	node,
	location
) => {
	if (node.kind !== "object") return undefined;
	if (path === "variants") {
		return errorDiagnostic(
			"config.variantsAreAList",
			location,
			`"variants" is a list of names now, such as ["mock", "debug"], not a map of on and off. ` +
				`A variant is off unless the active mode lists it under "modes" or --variant turns it on. See ${MODES_LINK}.`
		);
	}
	return MODE_VARIANTS_PATH.test(path)
		? errorDiagnostic(
				"config.variantsAreAList",
				location,
				`"${path}" is a list of the variants the mode turns on, such as ["mock"], not a map of on and off. See ${MODES_LINK}.`
			)
		: undefined;
};
