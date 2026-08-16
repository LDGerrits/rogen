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
