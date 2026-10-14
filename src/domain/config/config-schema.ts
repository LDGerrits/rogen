import { JSONSchema } from "../../base/json-schema.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { SUPPORTED_SERVICES } from "../roblox/supported-services.js";
import { DeclaredKeys } from "./declared-keys.js";

const NAME_PATTERN = DeclaredKeys.NAME.source;

const routesSchema: JSONSchema = {
	type: "object",
	default: {},
	description:
		'Route key -> "Service" or "Service/Folder/...", where Service is ' +
		"any service Rojo can write to, such as ServerScriptService or " +
		"ReplicatedStorage. Only declared " +
		"keys route: there is no built-in set, so a config without " +
		"routes routes nothing and scans no source path (rogen init writes " +
		"a starting set).",
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

const node: JSONSchema = {
	type: "object",
	properties: {
		$className: { type: "string" },
		$path: {
			type: ["string", "object"],
			properties: { optional: { type: "string" } },
		},
		$properties: { type: "object" },
		$attributes: { type: "object" },
		$ignoreUnknownInstances: { type: "boolean" },
		$id: { type: "string" },
	},
	additionalProperties: { type: "object" },
};

const numbers: JSONSchema = { type: "array", items: { type: "number" } };
const strings: JSONSchema = { type: "array", items: { type: "string" } };

/** `schema` that also accepts `null`, which a project uses to remove a key; the keys below it do too. */
function removable(schema: JSONSchema): JSONSchema {
	const types = [schema.type ?? []].flat();
	return {
		...schema,
		...(types.length > 0 && !types.includes("null")
			? { type: [...types, "null"] }
			: {}),
		...(schema.properties
			? {
					properties: Object.fromEntries(
						Object.entries(schema.properties).map(
							([key, value]) => [key, removable(value)]
						)
					),
				}
			: {}),
		...(typeof schema.additionalProperties === "object"
			? { additionalProperties: removable(schema.additionalProperties) }
			: {}),
	};
}

/** The keys of Rojo's project file, in the order Rojo writes them. */
const rojoFields: Readonly<Record<string, JSONSchema>> = {
	$schema: {
		type: "string",
		description: "The published JSON Schema URI for editor validation.",
	},
	name: {
		type: "string",
		description:
			"The name of the game. default.project.json carries it only " +
			"when it is set here; Rojo names the project after its folder " +
			"otherwise.",
	},
	tree: {
		...node,
		description:
			"The instance tree Rojo syncs, as in any Rojo project file. " +
			"Rogen merges the nodes it generates into it; the tree wins a " +
			"clash. Defaults to a bare DataModel; with routes its root " +
			"must be a DataModel.",
	},
	servePort: {
		type: "number",
		description: "The port rojo serve listens on.",
	},
	servePlaceIds: {
		...numbers,
		description: "The place IDs the project may sync into.",
	},
	blockedPlaceIds: {
		...numbers,
		description: "The place IDs the project may not sync into.",
	},
	placeId: { type: "number", description: "The place's ID." },
	gameId: { type: "number", description: "The place's game ID." },
	serveAddress: {
		type: "string",
		description: "The address rojo serve listens on.",
	},
	serveAllowedHosts: {
		...strings,
		description: "Host names rojo serve accepts beyond the bind address.",
	},
	emitLegacyScripts: {
		type: "boolean",
		description:
			"Whether Rojo makes Script and LocalScript instances for " +
			".server and .client files, rather than a run context.",
	},
	globIgnorePaths: {
		...strings,
		description:
			"Globs, relative to this file's folder, of files Rojo " +
			"ignores. Rogen keeps them out of routing too, and writes " +
			"them for Rojo.",
	},
	syncRules: {
		type: "array",
		items: { type: "object" },
		description:
			"Rojo's sync rules. Rogen doesn't support them yet, and " +
			"refuses a config that sets them.",
	},
	syncbackRules: {
		type: "object",
		description: "Rojo's syncback rules, passed through.",
	},
};

const rogenSchemas: Readonly<Record<string, JSONSchema>> = {
	sourcePaths: {
		type: "array",
		items: { type: "string" },
		default: ["src"],
		description:
			"Folders Rogen scans and watches, merged into one tree; the " +
			'last wins on a clash. Defaults to ["src"] when the config ' +
			"declares routes; without routes nothing is scanned.",
	},
	routes: routesSchema,
	syncPath: {
		type: "string",
		description:
			"The folder Rojo syncs from, when that isn't your source " +
			"paths. Set it to your compiler's output folder - " +
			'"out" for roblox-ts, "dist" for Darklua. Leave it out for ' +
			"plain Luau.",
	},
};
/** What a project may change: any key of the description but the ones that stand for the whole config. */
const projectChangeSchemas: Readonly<Record<string, JSONSchema>> =
	Object.fromEntries(
		Object.entries({ ...rojoFields, ...rogenSchemas })
			.filter(([key]) => key !== "$schema")
			.map(([key, schema]) => [key, removable(schema)])
	);

const projectsSchema: JSONSchema = {
	type: "object",
	description:
		"Other project files to write beside default.project.json, each " +
		"named for its file: dist writes dist.project.json. A project is " +
		"the description with the keys it sets changed: a list replaces " +
		"the list, routes, tree and the nodes below them merge by key, " +
		"and null removes a key. default is the description itself and " +
		"can't be a project name.",
	additionalProperties: {
		type: "object",
		properties: projectChangeSchemas,
	},
};

const wholeConfigSchemas: Readonly<Record<string, JSONSchema>> = {
	projects: projectsSchema,
	serveProject: {
		type: "string",
		default: "default",
		description:
			"The project rogen serve serves when none is named: default, or " +
			"a key of projects.",
	},
	placePaths: {
		...strings,
		description:
			"Folder globs, relative to this file, of the places this config " +
			"is shared by. Each matching folder is a place: it inherits this " +
			"config, adds its own code, and gets its own project files in " +
			"its folder. The config itself is never served; its places are.",
	},
};

/** The keys a `rogen.json` may hold. */
export const rojoKeys: readonly string[] = Object.keys(rojoFields);
export const rogenKeys: readonly string[] = [
	...Object.keys(rogenSchemas),
	...Object.keys(wholeConfigSchemas),
];

/** What a `rogen.json` may hold: Rojo's keys and Rogen's. A key outside both passes through with a warning. */
export const configSchema: JSONSchema = {
	type: "object",
	properties: { ...rojoFields, ...rogenSchemas, ...wholeConfigSchemas },
};

/** What a project file Rogen wrote may hold: Rojo's keys. */
export const projectFileSchema: JSONSchema = {
	type: "object",
	description:
		"A Rojo project file that Rogen wrote from a rogen.json. Edit the " +
		"rogen.json, not this file: the next build overwrites it.",
	additionalProperties: false,
	properties: rojoFields,
};

/** What replaces each field a config no longer has. */
const removedFields: Readonly<Record<string, string>> = {
	modes: 'Put what a mode set in a project under "projects", which is written beside default.project.json as <name>.project.json.',
	mode: "Modes are gone with \"modes\". Name a project instead, as 'rogen build <name>'.",
	server: "rogen serve starts Rojo. To serve with Argon, run 'rogen watch' to keep the project files current and 'argon serve' beside it.",
	variants:
		"A file that replaces another goes in a later source path, which wins a clash.",
	conflicts:
		'Variants are gone, and so are their conflict groups. Sets that exclude each other are one project each under "projects", listing their own "sourcePaths".',
	extends:
		'A rogen.json describes one folder. A second output is a project under "projects", which changes the keys it needs, or a rogen.json in another folder.',
	template:
		'Write the tree inline: move the template\'s "tree" and its other keys into rogen.json.',
	outFile: "Rogen writes default.project.json beside rogen.json.",
	exclude:
		'"globIgnorePaths" keeps files out of routing, and Rogen writes it for Rojo. To drop a mounted node, set it to null in a project under "projects".',
	rootDirs: 'It is called "sourcePaths" now.',
	syncDir: 'It is called "syncPath" now.',
};

/** The words for a field that Rogen once read and doesn't now, in place of "not a Rojo key". */
export function configRemovedFieldAdvice(
	path: string,
	location: DiagnosticLocation
): Diagnostic | undefined {
	return Object.hasOwn(removedFields, path)
		? errorDiagnostic(
				"config.removedField",
				location,
				`"${path}" was removed. ${removedFields[path]}`
			)
		: undefined;
}
