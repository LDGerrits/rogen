import { RojoTree } from "../rojo/tree.js";
import { Config } from "./config.js";

export const DEFAULT_TEMPLATE: RojoTree = {
	name: "roblox-game",
	tree: { $className: "DataModel" },
};

export const DEFAULT_CONFIG: Config = {
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
