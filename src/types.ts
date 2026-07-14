export interface CliArgs {
	help?: boolean;
	init?: boolean;
	config?: string;
	mode?: string;
	source?: string[];
	template?: string;
	output?: string;
	build?: string;
	watch?: boolean;
}

export interface RogenMode {
	output: string;
	build: string;
	env?: string[];
	exclude?: string[];
}

export type Casing = "PascalCase" | "camelCase";

export interface RogenConfig {
	source?: string | string[];
	fullNames?: boolean;
	casing?: Casing;
	aliases?: Record<string, string>;
	exclude?: string[];
	luau?: RogenMode;
	ts?: RogenMode;
	darklua?: RogenMode;
	template?: unknown;
	[key: string]: unknown;
}

export interface Environment {
	isTsProject: boolean;
	isDarkluaProject: boolean;
}

export interface RojoNode {
	$className?: string;
	$path?: string;
	[key: string]: unknown;
}

export interface RojoTree {
	name?: string;
	emitLegacyScripts?: boolean;
	tree: RojoNode;
}
