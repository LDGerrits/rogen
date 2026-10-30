import { JsonStructure } from "../../base/json-structure.js";

const node: JsonStructure = {
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

const strings: JsonStructure = { type: "array", items: { type: "string" } };

const placeId: JsonStructure = {
	type: "number",
	whole: { max: Number.MAX_SAFE_INTEGER },
};
const placeIds: JsonStructure = { type: "array", items: placeId };
const bool: JsonStructure = { type: "boolean" };

const rojoFields: Readonly<Record<string, JsonStructure>> = {
	$schema: { type: "string" },
	name: { type: "string" },
	tree: node,
	servePort: { type: "number", whole: { max: 65535 } },
	servePlaceIds: placeIds,
	blockedPlaceIds: placeIds,
	placeId,
	gameId: placeId,
	serveAddress: {
		type: "string",
		ipAddress: true,
		hint: 'Host names go in "serveAllowedHosts".',
	},
	serveAllowedHosts: strings,
	emitLegacyScripts: { type: "boolean" },
	globIgnorePaths: strings,
	syncRules: {
		type: "array",
		items: {
			type: "object",
			properties: {
				pattern: { type: "string" },
				exclude: { type: "string" },
				use: { type: "string" },
				suffix: { type: "string" },
			},
		},
	},
	syncbackRules: {
		type: "object",
		additionalProperties: false,
		properties: {
			ignoreTrees: strings,
			ignorePaths: strings,
			ignoreProperties: {
				type: "object",
				additionalProperties: strings,
			},
			syncCurrentCamera: bool,
			syncUnscriptable: bool,
			ignoreReferents: bool,
			createIgnoreDirPaths: bool,
		},
	},
};

const rogenFields: Readonly<Record<string, JsonStructure>> = {
	sourcePaths: strings,
	routes: { type: "object", additionalProperties: { type: "string" } },
	compiledPath: { type: "string" },
};

/** The keys of a project file that are Rojo's; Rojo accepts a `$schema` and ignores it. */
export const rojoKeys: readonly string[] = Object.keys(rojoFields);

/** The types a config holds, checked when it is read. */
export const configStructure: JsonStructure = {
	type: "object",
	properties: {
		...rojoFields,
		...rogenFields,
	},
};
