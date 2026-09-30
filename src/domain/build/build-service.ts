import { generateUuid } from "../../base/uuid.js";
import { toPosix } from "../../base/path.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-project.js";

/** How a route or tag key matched a file by its name. */
export type MatchForm = "folder" | "marker" | "separator" | "capital";

/** How the governing route matched the file; `fallback` is the `*` route. */
export type RouteMatch = MatchForm | "fallback";

export interface TagMatch {
	readonly tag: string;
	readonly form: MatchForm;
	/** The file name with a capital suffix written as a separator suffix. */
	readonly separatorName?: string;
}

/** Why the scan left a path out; the path is the key it is stored under. */
export type ScanLeftOut =
	| { readonly status: "excluded"; readonly pattern: string }
	/** A link that loops back to an ancestor or points at nothing, which Rojo must never walk. */
	| { readonly status: "skipped" };

/** Why the build leaves a path out of the tree, in the words `where` reports it. */
export type LeftOut =
	| ScanLeftOut
	/** No route governs it. */
	| { readonly status: "unrouted" }
	/** Every dormant tag it carries, the first first. */
	| { readonly status: "pruned"; readonly tags: readonly TagMatch[] }
	/** Another file took its instance path. */
	| { readonly status: "replaced"; readonly by: string }
	/** The template defines the node it would be, or a `$path` above it. */
	| { readonly status: "displaced"; readonly node: readonly string[] };

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
	/** Where `write` puts it. */
	readonly outFile: string;
	readonly tree: RojoTree;
	readonly warnings: readonly Diagnostic[];
	/** What `checkSyncDir` found; empty when it wasn't asked for. */
	readonly syncWarnings: readonly Diagnostic[];
	readonly summary: BuildSummary;
	/** The files whose contents the build read, which a change to must rebuild it. */
	readonly readFiles: readonly string[];
}

export interface WrittenProject {
	/** Whether the file changed; unchanged bytes are left alone. */
	readonly written: boolean;
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

/** The project file a config writes, and the staging files its writes go through. */
export class OutputFile {
	constructor(readonly path: string) {}

	/** A fresh file to stage a write through, so concurrent writers never share one. */
	stagingFile(): string {
		return `${this.path}.${generateUuid()}.tmp`;
	}

	/** Matches the staging file of any writer, in posix form. */
	get stagingPattern(): RegExp {
		const escaped = toPosix(this.path).replace(
			/[.*+?^${}()|[\]\\]/g,
			"\\$&"
		);
		return new RegExp(`^${escaped}\\.[^/]+\\.tmp$`);
	}
}

/**
 * Builds configs from the index and writes them. Every answer comes from the
 * same stages, so what `locate` reports is what `build` does.
 */
export interface BuildService {
	readonly _serviceBrand: undefined;

	/** What must hold across the configs before any is built: each declares routes, and no two write one file. */
	checkBuildable(
		configs: readonly ResolvedConfig[]
	): Result<void, DiagnosticsError>;

	/** Builds `config` in memory from an index of its root dirs, reading only folder meta from disk. */
	build(
		config: ResolvedConfig,
		options?: BuildOptions
	): Promise<Result<BuiltProject, DiagnosticsError>>;

	/**
	 * Writes `project` to its out file, leaving it untouched when its bytes
	 * wouldn't change, so Rojo doesn't re-sync and `watch` doesn't rebuild on
	 * its own write.
	 */
	write(
		project: BuiltProject
	): Promise<Result<WrittenProject, DiagnosticsError>>;

	/**
	 * Where each of `paths` lands in `config`'s tree, or why it lands nowhere;
	 * every scanned path without `paths`. A directory stands for what's in it,
	 * and a source file that doesn't exist yet is placed as if it did.
	 */
	locate(
		config: ResolvedConfig,
		paths?: readonly string[]
	): Promise<Result<FileLocation[], DiagnosticsError>>;
}

export const BuildService =
	createServiceIdentifier<BuildService>("buildService");
