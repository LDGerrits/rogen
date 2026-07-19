import { RojoTree } from "../rojo/tree.js";

export type CasingStyle = "camel" | "pascal";

export interface Mode {
	output: string;
	build: string;
	env: string[];
	globIgnorePaths: string[];
}

export interface UserConfig {
	source?: string | string[];
	verbatim?: boolean;
	casing?: CasingStyle;
	unwrap?: boolean;
	aliases?: Record<string, string>;
	globIgnorePaths?: string[];
	luau?: Partial<Mode>;
	ts?: Partial<Mode>;
	darklua?: Partial<Mode>;
	template?: RojoTree | string;
	[key: string]: unknown; // For custom modes
}

export interface ResolvedConfig {
	source: string[];
	verbatim: boolean;
	casing: CasingStyle;
	unwrap: boolean;
	aliases: Record<string, string>;
	globIgnorePaths: string[];
	luau?: Mode;
	ts?: Mode;
	darklua?: Mode;
	template: RojoTree;
	[key: string]: unknown;
}

export type CoreConfigKeys = keyof {
	[K in keyof ResolvedConfig as string extends K
		? never
		: number extends K
			? never
			: K]: ResolvedConfig[K];
};

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
