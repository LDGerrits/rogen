import { JSONSchema } from "../../base/json-schema.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { SUPPORTED_SERVICES } from "../roblox/supported-services.js";
import { SYNC_RULE_USES } from "../rojo/sync-rules.js";
import { ROGEN_BLOCK } from "./config.js";
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
			"them for Rojo. A mount of the tree whose folder or file a " +
			'glob names, or covers with "/**", is left out of the tree.',
	},
	syncRules: {
		type: "array",
		items: {
			type: "object",
			properties: {
				pattern: {
					type: "string",
					description: "A glob, relative to this file's folder.",
				},
				exclude: {
					type: "string",
					description: "A glob of files the rule leaves to the next.",
				},
				use: {
					type: "string",
					enum: [...SYNC_RULE_USES],
					description: "What the file becomes.",
				},
				suffix: {
					type: "string",
					description:
						"What is cut off the end of the file name to name the instance.",
				},
			},
		},
		description:
			"Rojo's sync rules: how a file name becomes an instance, tried " +
			"before Rojo's own rules, the first match winning. Rogen reads " +
			"files by them and writes them for Rojo. A file with sync rules " +
			"is Rojo-only: Argon rejects it.",
	},
	syncbackRules: {
		type: "object",
		description: "Rojo's syncback rules, passed through.",
	},
};

const rogenFields: Readonly<Record<string, JSONSchema>> = {
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
	compiledPath: {
		type: "string",
		description:
			"The folder Rojo syncs from, when that isn't your source " +
			"paths. Set it to your compiler's output folder - " +
			'"out" for roblox-ts, "dist" for Darklua. Leave it out for ' +
			"plain Luau.",
	},
};

export const rojoKeys: readonly string[] = Object.keys(rojoFields);
export const rogenKeys: readonly string[] = Object.keys(rogenFields);

const rogenBlock: JSONSchema = {
	type: "object",
	description:
		"Rogen's own keys. Without this block the file is a plain Rojo project file.",
	properties: rogenFields,
};

export const configSchema: JSONSchema = {
	type: "object",
	properties: { ...rojoFields, [ROGEN_BLOCK]: rogenBlock },
};

const advisedCompiledPath =
	"It is called compiledPath now, inside the rogen block.";

const removedFields: Readonly<Record<string, string>> = {
	modes: "Write what a mode set in <name>.rogen.json as a complete file with the keys that differ.",
	mode: "Modes are gone with \"modes\". Name a file instead, as 'rogen build <name>'.",
	server: "rogen serve starts Rojo. To serve with Argon, run 'rogen build --watch' to keep the project files current and 'argon serve' beside it.",
	variants:
		"A file that replaces another goes in a later source path, which wins a clash.",
	conflicts:
		'Variants are gone, and so are their conflict groups. Sets that exclude each other are one complete <name>.rogen.json each, listing their own "sourcePaths".',
	extends:
		"Config files don't read each other. Write a second complete <name>.rogen.json with the keys that differ.",
	projects:
		"Write <name>.rogen.json as a complete file with the keys that differ.",
	serveProject:
		"rogen serve serves default.rogen.json, or the file you name.",
	template:
		'Write the tree inline: move the template\'s "tree" and its other keys into default.rogen.json.',
	outFile: "Rogen writes default.project.json beside default.rogen.json.",
	exclude:
		'"globIgnorePaths" keeps files out of routing, leaves out a mount of the tree that it ignores, and Rogen writes it for Rojo.',
	placePaths:
		"A place is a folder with its own complete default.rogen.json. Name the place: rogen serve places/lobby",
	rootDirs: 'It is called "sourcePaths" now.',
	syncDir: advisedCompiledPath,
	syncPath: advisedCompiledPath,
};

/** Advice for a field Rogen once read and no longer does, in place of the unknown-key warning. */
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
