import { toPosix } from "../../base/path.js";
import { Result } from "../../base/result.js";
import {
	Diagnostic,
	RenameFix,
	diagnosticsAbout,
	diagnosticsReaching,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { SkippedPath } from "../../platform/diagnostics/skipped-path.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ConfigSelection } from "../config/config-service.js";
import {
	InstanceReference,
	requireExpression,
	whyNotRequirable,
} from "../roblox/roblox.js";
import {
	BuildRun,
	BuildSet,
	LeftOut,
	LoadedBuild,
	RouteMatch,
} from "./build.js";

interface Located {
	/** An absolute POSIX path. */
	readonly source: string;
	/** Whether the path is there now, rather than only placed as it would be once created. */
	readonly exists: boolean;
}

export interface PlacedLocation extends Located {
	readonly status: "placed";
	readonly instancePath: readonly string[];
	/** The other nodes an init script is, where its folder becomes a node in another route. */
	readonly alsoAt?: readonly (readonly string[])[];
	readonly route: string;
	readonly routeMatch: RouteMatch;
	/** A `^` on its name or a folder's took it straight to the route's target. */
	readonly hoisted?: boolean;
	/** The path was named as a file, and not found in a folder or behind an instance. */
	readonly named?: true;
	/** For a Luau file: a module, or a script that runs on its own. */
	readonly luau?: "module" | "script";
}

interface UnplacedLocation extends Located {
	/** `notInstance` exists but isn't an instance. */
	readonly status: "outside" | "notInstance" | "missing" | "empty";
	/** A `missing` path that is named as a folder, by ending in a separator. */
	readonly folder?: true;
}

/** The path can't be placed because the build of its config stops on an error; `by` is the first of them. */
interface BlockedLocation extends Located {
	readonly status: "blocked";
	readonly by: Diagnostic;
	/** `by` is about the path itself, not about a file the build stops on instead. */
	readonly own: boolean;
}

/** A file or folder inside a `$path` of the tree, which Rojo reads: `node` is the node that mounts it, `instancePath` the instance it becomes when Rojo reads one from it. */
export interface MountedLocation extends Located {
	readonly status: "mounted";
	readonly node: readonly string[];
	readonly instancePath?: readonly string[];
}

/** Where a path lands in the tree, or why it lands nowhere. */
export type FileLocation =
	| PlacedLocation
	| MountedLocation
	| (Exclude<LeftOut, { status: "mounted" }> & Located)
	| UnplacedLocation
	| BlockedLocation;

/** What a build raises about `location`: for a file the user named, everything that reaches it; for any other, only what is about that path. */
export function diagnosticsOf(
	location: FileLocation,
	diagnostics: readonly Diagnostic[]
): Diagnostic[] {
	return location.status === "placed" && location.named
		? diagnosticsReaching(diagnostics, location.source)
		: diagnosticsAbout(diagnostics, location.source);
}

/** The expression that requires the module a placed location is, if its path holds at runtime. */
export function requireExpressionOf(
	location: FileLocation
): string | undefined {
	return location.status === "placed" && location.luau === "module"
		? requireExpression(location.instancePath)
		: undefined;
}

/** For a file the user named: the call that requires it, or why none can. */
export function requireNoteOf(location: FileLocation): string | undefined {
	if (location.status !== "placed" || !location.named) return undefined;
	if (location.luau === undefined) return undefined;
	if (location.luau === "script")
		return "no require by this path: a script runs on its own and is not a module";
	const expression = requireExpression(location.instancePath);
	if (expression) return `require(${expression})`;
	const reason = whyNotRequirable(location.instancePath);
	return reason && `no require by this path: ${reason}`;
}

/** The files placed at an instance or inside it; none when no file places it. */
export interface InstanceLocation {
	readonly reference: InstanceReference;
	readonly files: readonly (PlacedLocation | MountedLocation)[];
	/** When no file places it: the absolute POSIX folders a new file for it goes in. */
	readonly folders: readonly string[];
	/** When no file places it: the renames of files that would, from the diagnostics that propose them. */
	readonly fixes: readonly InstanceFix[];
}

/** A rename, proposed by the diagnostic `code`, after which a file places the instance. Paths are absolute POSIX. */
export interface InstanceFix {
	readonly code: string;
	readonly rename: RenameFix["rename"];
}

export interface ConfigLocations {
	readonly config: ResolvedConfig;
	/** One per path argument; every file when no argument was given. */
	readonly files: readonly FileLocation[];
	readonly instances: readonly InstanceLocation[];
	readonly queried: readonly string[];
	/** What a build of the config raises, without the compiled path's: the errors that stopped the later phases, else the warnings. */
	readonly diagnostics: readonly Diagnostic[];
}

/** One thing `where` was asked about: a path, resolved and written with slashes, or an instance. */
export type Asked = { readonly path: string } | { readonly instance: string };

export interface Locations {
	/** No path or instance was asked about, so `files` holds every file. */
	readonly everyFile: boolean;
	/** Everything asked about, in the order it was given. */
	readonly asked: readonly Asked[];
	readonly configs: readonly ConfigLocations[];
	/** Why the configs that didn't load did not answer. */
	readonly errors: readonly Diagnostic[];
	/** The project files on disk that differ from what a build would write, as `check` raises them; empty unless `staleness` was asked for. */
	readonly stale: readonly Diagnostic[];
}

/** What `locate` is asked about; `cwd` resolves relative paths and tells a path from an instance. */
export interface LocateQuery {
	readonly args: readonly string[];
	readonly cwd: string;
	/** Also say which project files differ from what a build would write, from the same scan. */
	readonly staleness?: boolean;
}

export interface Diagnosis {
	readonly diagnostics: readonly Diagnostic[];
	/** Errors that stop a build but are not about the paths asked about, so the check went only as far as the build gets. */
	readonly stoppedBy: readonly Diagnostic[];
	/** The paths asked about that no build reads and that no diagnostic is about. */
	readonly skipped: readonly SkippedPath[];
}

/** The files asked about that no selected config reads: outside the source paths of every one. */
export function outsideEveryConfig(
	configs: readonly ConfigLocations[]
): string[] {
	const [first, ...others] = configs;
	if (!first) return [];
	return first.files
		.filter(({ status }) => status === "outside")
		.map(({ source }) => source)
		.filter((source) =>
			others.every(({ files }) =>
				files.some(
					(file) =>
						file.source === source && file.status === "outside"
				)
			)
		);
}

/** Each of `sources`, outside every config, once for each config that covers its folder. */
export function skippedOutside(
	sources: readonly string[],
	configs: readonly ConfigLocations[]
): SkippedPath[] {
	return sources.flatMap((path) =>
		configs.map(({ config }) => ({
			path,
			reason: "outsideSourcePaths" as const,
			config: toPosix(config.file),
		}))
	);
}

/** One `diagnose` for what several configs were each asked about. */
export function mergeDiagnoses(parts: readonly Diagnosis[]): Diagnosis {
	return {
		diagnostics: uniqueDiagnostics(
			parts.flatMap(({ diagnostics }) => diagnostics)
		),
		stoppedBy: uniqueDiagnostics(
			parts.flatMap(({ stoppedBy }) => stoppedBy)
		),
		skipped: uniqueSkipped(parts.flatMap(({ skipped }) => skipped)),
	};
}

/** `skipped` without the repeats. */
export function uniqueSkipped(skipped: readonly SkippedPath[]): SkippedPath[] {
	const seen = new Set<string>();
	return skipped.filter(({ path, reason, config }) => {
		const key = `${reason}\0${path}\0${config ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** One `locate` for what several configs were each asked about, the configs in the order given. */
export function mergeLocations(
	parts: readonly Locations[],
	asked: readonly Asked[]
): Locations {
	return {
		everyFile: false,
		asked,
		configs: parts.flatMap((part) => part.configs),
		errors: uniqueDiagnostics(parts.flatMap((part) => part.errors)),
		stale: uniqueDiagnostics(parts.flatMap((part) => part.stale)),
	};
}

/** Builds configs from the index and writes them; `build`, `rebuild` and `locate` place files the same way. */
export interface BuildService {
	readonly _serviceBrand: undefined;

	/** Builds each selected config that loads and writes them in order; a config that fails or doesn't load writes nothing, and a failed write leaves the rest unwritten. */
	build(selection: ConfigSelection): Promise<BuildRun>;

	/** Builds and writes the project at `projectFile` in a watch's `set`; the compiled path is checked only when `previous` holds no answer for this version of the config. With `rewrite`, the file is written even when its bytes are what a build makes. */
	rebuild(
		set: BuildSet,
		projectFile: string,
		listing: IndexReader,
		previous?: LoadedBuild,
		rewrite?: boolean
	): Promise<LoadedBuild>;

	/** What a build raises about each of `targets.args`, and why any config didn't load; with no arguments, about every config. Writes nothing; fails as `locate` does. */
	diagnose(
		selection: ConfigSelection,
		targets?: LocateQuery
	): Promise<Result<Diagnosis, DiagnosticsError>>;

	/** What each of `query.args` is, one entry each and in order: a path, resolved, or an instance. */
	askedAbout(query: LocateQuery): Promise<readonly Asked[]>;

	/** The project files on disk that differ from what a build would write, as the diagnostics `check` raises for them. Writes nothing. */
	staleProjectFiles(selection: ConfigSelection): Promise<Diagnostic[]>;

	/** Where each argument lands in every config of `selection`: a path gives its file, a directory what's in it, an instance the files placed at or inside it; no arguments give every file. */
	locate(
		selection: ConfigSelection,
		targets?: LocateQuery
	): Promise<Result<Locations, DiagnosticsError>>;
}

export const BuildService =
	createServiceIdentifier<BuildService>("buildService");
