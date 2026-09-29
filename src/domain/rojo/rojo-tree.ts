import { isObject } from "../../base/object.js";

export interface OptionalRojoPath {
	readonly optional: string;
}

export type RojoPath = string | OptionalRojoPath;

export function isRojoPath(value: unknown): value is RojoPath {
	return (
		typeof value === "string" ||
		(isObject(value) && typeof value.optional === "string")
	);
}

export interface RojoNode {
	$className?: string;
	$path?: RojoPath;
	$properties?: Record<string, unknown>;
	$attributes?: Record<string, unknown>;
	$ignoreUnknownInstances?: boolean;
	$id?: string;
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
