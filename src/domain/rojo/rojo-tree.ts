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

/** The file or directory a `$path` points at, whichever form it's written in. */
export function rojoPathTarget(rojoPath: RojoPath): string {
	return typeof rojoPath === "string" ? rojoPath : rojoPath.optional;
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

const INSTANCE_SEPARATOR = "/";

/** An instance path written as one key, such as `ReplicatedStorage/Shared/Util`. */
export function instanceKey(instancePath: readonly string[]): string {
	return instancePath.join(INSTANCE_SEPARATOR);
}

/** A node's children: every key Rojo reads as an instance name, in file order. */
export function childNodes(node: RojoNode): [string, RojoNode][] {
	return Object.entries(node).filter(
		(entry): entry is [string, RojoNode] =>
			!entry[0].startsWith("$") && isObject(entry[1])
	);
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
