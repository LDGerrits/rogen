import { RojoTree } from "../rojo/tree.js";
import { ResolvedConfig } from "./config.js";

export const DEFAULT_TEMPLATE: RojoTree = {
	name: "roblox-game",
	tree: { $className: "DataModel" },
};

export const DEFAULT_CONFIG: ResolvedConfig = {
	source: ["src"],
	globIgnorePaths: [],
	aliases: {},
	unwrap: false,
	verbatim: false,
	casing: "camel",
	luau: {
		output: "default.project.json",
		build: "src",
		env: [],
		globIgnorePaths: [],
	},
	ts: {
		output: "default.project.json",
		build: "out",
		env: [],
		globIgnorePaths: [],
	},
	darklua: {
		output: "build.project.json",
		build: "dist",
		env: [],
		globIgnorePaths: [],
	},
	template: DEFAULT_TEMPLATE,
};
