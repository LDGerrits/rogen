import { RojoTree } from "../rojo/tree.js";

export type CasingStyle = "camel" | "pascal";

export interface Mode {
	output: string;
	build: string;
	env: string[];
	globIgnorePaths: string[];
}

export interface Config {
	source: string | string[];
	verbatim: boolean;
	casing: CasingStyle;
	unwrap: boolean;
	aliases: Record<string, string>;
	globIgnorePaths: string[];
	luau: Mode;
	ts: Mode;
	darklua: Mode;
	template: RojoTree;
	[key: string]: unknown;
}
