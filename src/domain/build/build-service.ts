import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import { LeftOut, RouteMatch, TagMatch } from "./build-record.js";

export type { RouteMatch } from "./build-record.js";

export interface RootSummary {
	readonly rootDir: string;
	readonly files: number;
	readonly excluded: number;
	readonly skippedLinks: number;
}

export interface RouteSummary {
	readonly key: string;
	readonly target: string;
	readonly files: number;
}

export interface TagSummary {
	readonly tag: string;
	readonly on: boolean;
	/** Files placed with the tag when it's on, or left out by it when it's off. */
	readonly files: number;
}

export interface BuildSummary {
	readonly roots: readonly RootSummary[];
	/** In the order the config declares them. */
	readonly routes: readonly RouteSummary[];
	readonly tags: readonly TagSummary[];
	readonly unrouted: number;
	readonly superseded: number;
	/** Left out because the template defines their node. */
	readonly displaced: number;
}

export interface BuildOptions {
	/**
	 * Also check that the sync dir holds the compiler's output for every root
	 * dir and meta file. That only changes when the compiler runs, so a watch
	 * checks it when a config loads rather than on every rebuild.
	 */
	readonly checkSyncDir?: boolean;
}

/** One config built in memory; writing it is the caller's step. */
export interface BuiltProject {
	readonly tree: RojoTree;
	readonly warnings: readonly Diagnostic[];
	/** What `checkSyncDir` found; empty when it wasn't asked for. */
	readonly syncWarnings: readonly Diagnostic[];
	readonly summary: BuildSummary;
}

interface Located {
	/** An absolute POSIX path. */
	readonly source: string;
}

export interface PlacedLocation extends Located {
	readonly status: "placed";
	readonly instancePath: readonly string[];
	readonly route: string;
	readonly routeMatch: RouteMatch;
	/** The active tags the file carries. */
	readonly tags: readonly TagMatch[];
}

export interface UnplacedLocation extends Located {
	/** `ignored` exists but isn't an instance. */
	readonly status: "outside" | "ignored" | "missing" | "empty";
}

/** Where a path lands in the tree, or why it lands nowhere. */
export type FileLocation =
	PlacedLocation | (LeftOut & Located) | UnplacedLocation;

/**
 * Builds configs from the index. Every answer comes from the same stages, so
 * what `locate` reports is what `build` does.
 */
export interface BuildService {
	readonly _serviceBrand: undefined;

	/** What must hold across the configs before any is built: each declares routes, and no two write one file. */
	checkBuildable(configs: readonly ResolvedConfig[]): Diagnostic[];

	/** Builds `config` from the index, which the caller initialized with `rootsToIndex`; reads only folder meta from disk. */
	build(
		config: ResolvedConfig,
		options?: BuildOptions
	): Promise<Result<BuiltProject, Diagnostic[]>>;

	/**
	 * Where each of `paths` lands in `config`'s tree, or why it lands nowhere;
	 * every scanned path without `paths`. A directory stands for what's in it,
	 * and a source file that doesn't exist yet is placed as if it did.
	 */
	locate(
		config: ResolvedConfig,
		paths?: readonly string[]
	): Result<FileLocation[], Diagnostic[]>;
}

export const BuildService =
	createServiceIdentifier<BuildService>("buildService");
