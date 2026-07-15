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

export interface Mode {
	output: string;
	build: string;
	env: string[];
	exclude: string[];
}

export type Casing = "PascalCase" | "camelCase";

export interface Config {
	source: string | string[];
	fullNames: boolean;
	casing: Casing;
	aliases: Record<string, string>;
	exclude: string[];
	luau: Mode;
	ts: Mode;
	darklua: Mode;
	template: RojoTree;
	[key: string]: unknown;
}

export type ConfigKeys = keyof {
	[K in keyof Config as string extends K
		? never
		: number extends K
			? never
			: K]: Config[K];
};

export interface Environment {
	isTsProject: boolean;
	isDarkluaProject: boolean;
}

export interface RojoNode {
	$className?: string;
	$path?: string;
	$properties?: Record<string, unknown>;
	$ignoreUnknownInstances?: boolean;
	[key: string]: unknown;
}

export interface RojoTree {
	name: string;
	tree: RojoNode;
	servePort?: number;
	servePlaceIds?: number[];
	placeId?: number;
	gameId?: number;
	serveAddress?: string;
	globIgnorePaths?: string[];
	emitLegacyScripts?: boolean;
}
