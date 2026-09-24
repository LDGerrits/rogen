export interface OptionalRojoPath {
	readonly optional: string;
}

export type RojoPath = string | OptionalRojoPath;

export interface RojoNode {
	$className?: string;
	$path?: RojoPath;
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
