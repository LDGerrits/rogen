import { JSONSchema } from "../../base/json-schema.js";
import { DOCS_URL } from "../../platform/product/product-service.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	UnknownFieldAdvisor,
	WrongTypeAdvisor,
} from "../../platform/jsonc/jsonc-document-reader.js";
import {
	ConfigModel,
	MergePolicies,
	MergePolicy,
} from "../../platform/config/config-models.js";
import { SUPPORTED_SERVICES } from "../roblox/supported-services.js";
import { DeclaredKeys, RogenConfig, SERVER_NAMES } from "./config.js";

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
		"--variant turns it on. A declared name " +
		"marks files (Analytics.mock.luau, a mock folder, a .mock marker); " +
		"an undeclared one ships silently as part of an instance name.",
};

const conflictsSchema: JSONSchema = {
	type: "array",
	items: { type: "array", items: { type: "string" } },
	default: [],
	description:
		"Groups of declared variants of which at most one may be on, such as " +
		'[["halloween", "christmas"]]. A group names declared variants.',
};

/** How a relative path in a field resolves against the directory of the file that wrote it: a path or a list of them with `path.resolve`, globs joined in POSIX form. */
export type PathForm = "path" | "paths" | "globs";

interface ConfigField {
	readonly schema: JSONSchema;
	/** How a child's value combines with its parent's across `extends`. */
	readonly merge: MergePolicy;
	/** What paths it holds. */
	readonly paths?: PathForm;
	/** Only the config itself sets it; a parent's value is dropped. */
	readonly leafOnly?: true;
}

/** One entry per field of a config file, so a field can't be added without saying how it merges and what paths it holds. */
const fields: Record<keyof RogenConfig, ConfigField> = {
	$schema: {
		merge: "replace",
		leafOnly: true,
		schema: {
			type: "string",
			description: "The published JSON Schema URI for editor validation.",
		},
	},
	extends: {
		merge: "replace",
		leafOnly: true,
		schema: {
			type: "string",
			description:
				"Another *.rogen.json to inherit from, relative to this file.",
		},
	},
	rootDirs: {
		merge: "append",
		paths: "paths",
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
	exclude: {
		merge: "append",
		paths: "globs",
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
		paths: "path",
		schema: {
			type: "string",
			description:
				"A Rojo project file whose tree Rogen merges its generated " +
				"nodes into.",
		},
	},
	syncDir: {
		merge: "replace",
		paths: "path",
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
		paths: "path",
		leafOnly: true,
		schema: {
			type: "string",
			description:
				"The Rojo project file Rogen writes. Defaults to this " +
				"config's own file name, with .rogen.json replaced by " +
				".project.json.",
		},
	},
	server: {
		merge: "replace",
		schema: {
			type: "string",
			enum: [...SERVER_NAMES],
			description:
				"The sync server rogen serve starts, rojo or argon, unless " +
				"--server says otherwise. Without it, the one the project " +
				"pins, Rojo before Argon.",
		},
	},
};

/** How each top-level field combines across a config's chain. */
export const configMergePolicies: MergePolicies = Object.fromEntries(
	Object.entries(fields).map(([key, field]) => [key, field.merge])
);

/** What paths each field holds, for the fields that hold any. */
export const configPathForms: Readonly<Record<string, PathForm>> =
	Object.fromEntries(
		Object.entries(fields).flatMap(([key, field]) =>
			field.paths === undefined ? [] : [[key, field.paths] as const]
		)
	);

/** The fields a parent in an `extends` chain never passes on. */
export const configLeafOnlyKeys: readonly string[] = Object.entries(fields)
	.filter(([, field]) => field.leafOnly)
	.map(([key]) => key);

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

const VARIANTS_LINK = `${DOCS_URL}/core-concepts/variants#declaring-variants`;

/** What replaces each field a config no longer has. */
const removedFields: Readonly<Record<string, string>> = {
	modes: 'Put what a mode set in a second config that extends this one, which can add "exclude", and turn variants on with --variant.',
	mode: "Modes are gone with \"modes\". Build the config that holds the settings by name, as 'rogen build <name>'.",
};

/** The words for a field that Rogen once read and doesn't now, in place of "unknown field". */
export const configRemovedFieldAdvice: UnknownFieldAdvisor = (
	path,
	location
) =>
	Object.hasOwn(removedFields, path)
		? errorDiagnostic(
				"config.removedField",
				location,
				`"${path}" was removed. ${removedFields[path]}`
			)
		: undefined;

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
				`A variant is off unless --variant turns it on. See ${VARIANTS_LINK}.`
		);
	}
	return undefined;
};
