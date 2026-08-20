import { Registry } from "../../platform/registry/registry.js";
import {
	Extensions,
	ConfigRegistry,
	JSONSchema,
} from "../../platform/config/config-registry.js";
import { RojoTree } from "../rojo/rojo-project.js";

export interface Mode {
	output: string;
	build: string;
	env: string[];
	globIgnorePaths: string[];
}

export interface ResolvedConfig extends Record<string, unknown> {
	source: string[];
	verbatim: boolean;
	unwrap: boolean;
	casing: "camelCase" | "PascalCase" | "camel" | "pascal";
	aliases: Record<string, string>;
	globIgnorePaths: string[];
	luau?: Mode;
	ts?: Mode;
	darklua?: Mode;
	template?: RojoTree;
}

export const defaultTemplate: RojoTree = {
	name: "roblox-game",
	tree: { $className: "DataModel" },
};

const registry = Registry.as<ConfigRegistry>(Extensions.Config);

const modeSchema: JSONSchema = {
	type: "object",
	properties: {
		output: { type: "string" },
		build: { type: "string" },
		env: { type: "array", items: { type: "string" } },
		globIgnorePaths: { type: "array", items: { type: "string" } },
	},
};

registry.registerConfig({
	id: "rogen.core",
	title: "Core Rogen Configuration",
	type: "object",
	properties: {
		source: {
			type: ["string", "array"],
			items: { type: "string" },
			default: ["src"],
			description: "The source directories containing uncompiled code.",
		},
		verbatim: {
			type: "boolean",
			default: false,
			description:
				"If true, treats all files as verbatim string modules.",
		},
		unwrap: {
			type: "boolean",
			default: false,
		},
		casing: {
			type: "string",
			enum: ["camelCase", "PascalCase", "camel", "pascal"],
			default: "camelCase",
			description: "The casing convention used for emitted file names.",
		},
		aliases: {
			type: "object",
			default: {},
			description: "Path aliases for module resolution.",
		},
		globIgnorePaths: {
			type: "array",
			items: { type: "string" },
			default: [],
		},
		luau: {
			...modeSchema,
			default: {
				output: "default.project.json",
				build: "src",
				env: [],
				globIgnorePaths: [],
			},
		},
		ts: {
			...modeSchema,
			default: {
				output: "default.project.json",
				build: "out",
				env: [],
				globIgnorePaths: [],
			},
		},
		darklua: {
			...modeSchema,
			default: {
				output: "build.project.json",
				build: "dist",
				env: [],
				globIgnorePaths: [],
			},
		},
		template: {
			type: "object",
			default: defaultTemplate,
		},
	},
});
