import path from "path";
import { groupBy } from "../../base/collections.js";
import { toPosix } from "../../base/path.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { InstanceReference } from "../roblox/roblox.js";

/** How a route or variant key matched a file by its name. */
export type MatchForm = "folder" | "marker" | "suffix";

/** How the governing route matched the file; `fallback` is the `*` route. */
export type RouteMatch = MatchForm | "fallback";

export interface VariantMatch {
	readonly variant: string;
	readonly form: MatchForm;
}

/** Why the scan left a path out; the path is the key it is stored under. */
export type ScanLeftOut =
	| { readonly status: "excluded"; readonly pattern: string }
	/** The template mounts it with a `$path` at `node`, so Rojo reads it and Rogen leaves it alone. */
	| { readonly status: "mounted"; readonly node: readonly string[] }
	/** A link that loops back to an ancestor or points at nothing, which Rojo must never walk. */
	| { readonly status: "skipped" };

/** Why the build leaves a path out of the tree, in the words `where` reports it. */
export type LeftOut =
	| ScanLeftOut
	/** No route governs it. */
	| { readonly status: "unrouted" }
	/** Every dormant variant it carries, the first first. */
	| { readonly status: "pruned"; readonly variants: readonly VariantMatch[] }
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

export interface VariantSummary {
	readonly variant: string;
	readonly on: boolean;
	/** Files placed with the variant when it's on, or left out by it when it's off. */
	readonly files: number;
}

export interface BuildSummary {
	readonly roots: readonly RootSummary[];
	/** In the order the config declares them. */
	readonly routes: readonly RouteSummary[];
	readonly variants: readonly VariantSummary[];
	readonly unrouted: number;
	readonly superseded: number;
	/** Left out because the template defines their node. */
	readonly displaced: number;
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

/** A config whose build, write or set check went wrong; `said` is what its build warned about before that. */
export function failedBuild(
	config: ResolvedConfig,
	errors: readonly Diagnostic[],
	said: Pick<ConfigBuild, "warnings" | "syncWarnings"> = {
		warnings: [],
		syncWarnings: [],
	}
): ConfigBuild {
	const { warnings, syncWarnings } = said;
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
	/** The active variants the file carries. */
	readonly variants: readonly VariantMatch[];
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

/** Where `locate` found things in one config. */
export interface ConfigLocations {
	readonly config: ResolvedConfig;
	/** One per path argument; every file when no argument was given. */
	readonly files: readonly FileLocation[];
	/** One per instance argument. */
	readonly instances: readonly InstanceLocation[];
}

/** What a sync tool writes in place of a `.meta.json`. */
export interface MetaReplacement {
	readonly suffix: string;
	/** Says why, in the warning about the meta Rojo no longer applies. */
	readonly note: string;
}

/** What a sync tool does to a data file: it writes a Lua module in its place, which Rojo syncs as a ModuleScript. */
export interface DataReplacement {
	/** Says which data files, in the warning about the file Rojo no longer finds. */
	readonly note: string;
}

/** A tool that rewrites code between the root dirs and the sync dir, which Rojo reads in their place; the build asks it, and never names one. */
export interface SyncTool {
	readonly id: string;
	/** The path the tool writes for a source path, when it renames it. */
	emittedPath?(source: string): string;
	/** Whether the tool reads a source but never writes anything for it. */
	readsOnly?(source: string): boolean;
	/** What it writes instead of a `.meta.json`, which Rojo then no longer applies. */
	readonly metaReplacement?: MetaReplacement;
	/** What it writes instead of a data file, such as a `.txt`, which Rojo then no longer finds. */
	readonly dataReplacement?: DataReplacement;
}

/** What `locate` found, config by config. */
export interface Locations {
	/** No path or instance was asked about, so `files` holds every file. */
	readonly everyFile: boolean;
	readonly configs: readonly ConfigLocations[];
}

/** The project file a config writes, and the staging files its writes go through. */
export class OutputFile {
	constructor(readonly path: string) {}

	/** Matches the staging file of any writer, in posix form. */
	get stagingPattern(): RegExp {
		const escaped = toPosix(this.path).replace(
			/[.*+?^${}()|[\]\\]/g,
			"\\$&"
		);
		return new RegExp(`^${escaped}\\.[^/]+\\.tmp$`);
	}
}

/** Nothing can be placed without a route. */
export function missingRoutes(config: ResolvedConfig): Diagnostic[] {
	return config.routes.size > 0
		? []
		: [
				errorDiagnostic(
					"route.noRoutes",
					{ resource: config.file },
					'no routes declared, so nothing can be placed.\nAdd a "routes" map — `rogen init` writes a starting set.'
				),
			];
}

interface Blocker {
	readonly diagnostic: Diagnostic;
	readonly files: readonly string[];
}

/** Why a set of configs can't be built together: one that declares no routes, or several that write one file. */
export class BuildBlockers {
	private readonly blockers: readonly Blocker[];

	constructor(configs: readonly ResolvedConfig[]) {
		const byOutFile = groupBy(
			configs,
			({ outFile }) => path.resolve(outFile),
			({ file }) => file
		);
		this.blockers = [
			...configs.flatMap((config) =>
				missingRoutes(config).map((diagnostic) => ({
					diagnostic,
					files: [config.file],
				}))
			),
			...[...byOutFile]
				.filter(([, files]) => files.length > 1)
				.map(([outFile, files]) => ({
					diagnostic: errorDiagnostic(
						"output.sameOutFile",
						{ resource: outFile },
						`${files.map((file) => `"${path.basename(file)}"`).join(" and ")} write the same file, ${outFile}. Give each its own "outFile".`
					),
					files,
				})),
		];
	}

	/** Each problem once, in the order it is reported. */
	get diagnostics(): readonly Diagnostic[] {
		return this.blockers.map(({ diagnostic }) => diagnostic);
	}

	/** The config files some problem blocks. */
	get files(): ReadonlySet<string> {
		return new Set(this.blockers.flatMap(({ files }) => files));
	}

	/** The problems that block the config file `file`; none when it can be built. */
	blocking(file: string): readonly Diagnostic[] {
		return this.blockers
			.filter(({ files }) => files.includes(file))
			.map(({ diagnostic }) => diagnostic);
	}
}
