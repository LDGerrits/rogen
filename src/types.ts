export interface CliArgs {
	help?: boolean;
	version?: boolean;
	init?: boolean;
	config?: string;
	mode?: string[];
	source?: string[];
	tag?: string[];
	project?: string;
	output?: string;
	build?: string;
	watch?: boolean;
}

export interface Mode {
	output: string;
	build: string;
	tags: Record<string, boolean>;
	globIgnorePaths: string[];
}

export type Casing = "PascalCase" | "camelCase";

export interface Config {
	source: string | string[];
	tags: Record<string, boolean>;
	verbatim: boolean;
	casing: Casing;
	unwrap: boolean;
	aliases: Record<string, string>;
	globIgnorePaths: string[];
	luau: Mode;
	ts: Mode;
	darklua: Mode;
	project: RojoTree;
	[key: string]: unknown;
}

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
