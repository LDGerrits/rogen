import { randomUUID } from "crypto";
import { toPosix } from "../../base/path.js";
import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigSelection, ResolvedEntry } from "../config/config-service.js";
import { InstanceReference } from "../roblox/roblox.js";

/** How a route or tag key matched a file by its name. */
export type MatchForm = "folder" | "marker" | "separator" | "capital";

/** How the governing route matched the file; `fallback` is the `*` route. */
export type RouteMatch = MatchForm | "fallback";

export interface TagMatch {
	readonly tag: string;
	readonly form: MatchForm;
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
	/** Also checks the sync dir holds the compiler's output; that only changes when the compiler runs, so a watch does it on load. */
	readonly checkSyncDir?: boolean;
}

/** What a run did for one config. */
interface ConfigBuildFields {
	readonly config: ResolvedConfig;
	readonly warnings: readonly Diagnostic[];
	/** What `checkSyncDir` found; empty when it wasn't asked for. */
	readonly syncWarnings: readonly Diagnostic[];
	/** Why the config failed, none for any other outcome. */
	readonly errors: readonly Diagnostic[];
}

/** `failed` is a config whose build or write went wrong; `notWritten` built, but another config's failure stopped the run first. */
export type ConfigBuild = ConfigBuildFields &
	(
		| {
				readonly outcome: "wrote" | "unchanged" | "notWritten";
				readonly summary: BuildSummary;
				/** The files whose contents the build read, which a change to must rebuild it. */
				readonly readFiles: readonly string[];
		  }
		| {
				readonly outcome: "failed";
				readonly summary?: undefined;
				readonly readFiles?: undefined;
		  }
	);

/** A config whose build, write or set check went wrong; `warnings` are what its build said before that. */
export function failedBuild(
	config: ResolvedConfig,
	errors: readonly Diagnostic[],
	warnings: readonly Diagnostic[] = [],
	syncWarnings: readonly Diagnostic[] = []
): ConfigBuild {
	return { config, outcome: "failed", warnings, syncWarnings, errors };
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

/** The files placed at an instance or inside it; none when no file places it. */
export interface InstanceLocation {
	readonly reference: InstanceReference;
	readonly files: readonly PlacedLocation[];
}

/** What `locate` is asked about; `cwd` resolves relative paths and tells a path from an instance. */
export interface LocateTargets {
	readonly args: readonly string[];
	readonly cwd: string;
}

export interface ConfigLocations {
	/** One per path argument; every file when no argument was given. */
	readonly files: readonly FileLocation[];
	/** One per instance argument. */
	readonly instances: readonly InstanceLocation[];
}

/** The project file a config writes, and the staging files its writes go through. */
export class OutputFile {
	constructor(readonly path: string) {}

	/** A fresh file to stage a write through, so concurrent writers never share one. */
	stagingFile(): string {
		return `${this.path}.${randomUUID()}.tmp`;
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

/** Builds configs from the index and writes them; `locate` and `run` share every stage. */
export interface BuildService {
	readonly _serviceBrand: undefined;

	/** The resolved configs of `selection` when every one is valid and they can be built together, else every error. */
	requireBuildable(
		selection: ConfigSelection
	): Result<ResolvedEntry[], DiagnosticsError>;

	/** The configs that declare no routes or share an out file, by config file, each with why. */
	blockedConfigs(
		configs: readonly ResolvedConfig[]
	): ReadonlyMap<string, readonly Diagnostic[]>;

	/** Builds every config, then writes them in order; any build failure writes nothing, and a failed write leaves the rest unwritten. */
	run(
		configs: readonly ResolvedConfig[],
		options?: BuildOptions
	): Promise<ConfigBuild[]>;

	/** Where each argument lands in `config`'s tree: a path (relative to `cwd`) gives its file, and a directory stands for what's in it. An argument that starts with a service gives the files placed at that instance or inside it, unless `cwd` holds an entry of that name. No arguments give every file. */
	locate(
		config: ResolvedConfig,
		targets?: LocateTargets
	): Promise<Result<ConfigLocations, DiagnosticsError>>;
}

export const BuildService =
	createServiceIdentifier<BuildService>("buildService");
