import path from "path";
import { groupBy } from "../../base/collections.js";
import { toPosix } from "../../base/path.js";
import {
	Diagnostic,
	DiagnosticFix,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { Result, err, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig, configLabel } from "../config/config.js";
import { ConfigSelection } from "../config/config-service.js";
import { InstanceReference } from "../roblox/roblox.js";

/** How a route or variant key matched a file by its name. */
export type MatchForm = "folder" | "marker" | "suffix";

/** How the governing route matched the file; `init` is the route suffix of an init script in one of its folders, `copy` an init script placed where its folder's other files route it, and `fallback` the `*` route. */
export type RouteMatch = MatchForm | "init" | "copy" | "fallback";

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
	/** Paths the template mounts, which Rojo reads instead. */
	readonly mounted: number;
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

export interface ModeSummary {
	readonly mode: string;
	readonly on: boolean;
	/** Files placed with the mode when it's the active one, or left out by it when it isn't. */
	readonly files: number;
}

export interface BuildSummary {
	readonly roots: readonly RootSummary[];
	/** In the order the config declares them. */
	readonly routes: readonly RouteSummary[];
	readonly variants: readonly VariantSummary[];
	/** In the order the config declares them; none without modes. */
	readonly modes: readonly ModeSummary[];
	readonly unrouted: number;
	readonly replaced: number;
	/** Left out because the template defines their node. */
	readonly displaced: number;
}

/** What a run did for a config that loaded: the one record the build, the watch and every presenter read. Narrow it on `outcome`; each kind holds what its outcome has. */
export type LoadedBuild = WrittenBuild | UnwrittenBuild | FailedBuild;

/** What a run did for one selected config; one that didn't load has no `config`. */
export type ConfigBuild = LoadedBuild | UnloadedBuild;

/** What every kind of config build holds. */
abstract class AbstractConfigBuild {
	constructor(
		readonly config: ResolvedConfig,
		private readonly findings: BuildFindings
	) {}

	/** What the config is asked for by. */
	get label(): string {
		return this.config.label;
	}

	get warnings(): readonly Diagnostic[] {
		return this.findings.warnings;
	}

	/** What the sync dir check found for this version of the config, whether this build checked it or the previous one did; `undefined` while unknown. */
	get syncWarnings(): readonly Diagnostic[] | undefined {
		return this.findings.syncWarnings;
	}

	/** Everything the build has to say, in the order it is printed: warnings, then sync dir warnings. */
	get diagnostics(): readonly Diagnostic[] {
		return [...this.warnings, ...(this.syncWarnings ?? [])];
	}
}

/** A config built and written, or found unchanged on disk. */
export class WrittenBuild extends AbstractConfigBuild {
	constructor(
		config: ResolvedConfig,
		readonly outcome: "wrote" | "unchanged",
		findings: BuildFindings,
		/** What the build placed. */
		readonly summary: BuildSummary,
		/** The files whose contents the build read, which a change to must rebuild it. */
		readonly readFiles: readonly string[]
	) {
		super(config, findings);
	}

	get documentOutcome(): "wrote" | "unchanged" {
		return this.outcome;
	}
}

/** A config that didn't load, so there was nothing to build; `errors` is why. */
export class UnloadedBuild {
	readonly outcome = "notLoaded";

	constructor(
		/** The config file. */
		readonly file: string,
		readonly errors: readonly Diagnostic[]
	) {}

	/** What the config is asked for by. */
	get label(): string {
		return configLabel(this.file);
	}

	/** An unloaded config has no project file to write. */
	get documentOutcome(): "notWritten" {
		return "notWritten";
	}

	get warnings(): readonly Diagnostic[] {
		return [];
	}

	get syncWarnings(): undefined {
		return undefined;
	}

	get diagnostics(): readonly Diagnostic[] {
		return this.errors;
	}
}

/** A config that built cleanly, but whose run stopped before writing it because the configs named in `blockedBy` failed or didn't load. */
export class UnwrittenBuild extends AbstractConfigBuild {
	readonly outcome = "notWritten";

	constructor(
		config: ResolvedConfig,
		findings: BuildFindings,
		readonly summary: BuildSummary,
		readonly readFiles: readonly string[],
		/** The labels of those configs. */
		readonly blockedBy: readonly string[]
	) {
		super(config, findings);
	}

	get documentOutcome(): "notWritten" {
		return this.outcome;
	}
}

/** A config whose build, write or set check went wrong; `findings` is what its build found before that. */
export class FailedBuild extends AbstractConfigBuild {
	readonly outcome = "failed";

	constructor(
		config: ResolvedConfig,
		readonly errors: readonly Diagnostic[],
		findings: BuildFindings = { warnings: [], syncWarnings: undefined }
	) {
		super(config, findings);
	}

	/** Warnings, sync dir warnings, then the errors that failed it. */
	override get diagnostics(): readonly Diagnostic[] {
		return [...super.diagnostics, ...this.errors];
	}

	/** A failed config left its project file as it was. */
	get documentOutcome(): "notWritten" {
		return "notWritten";
	}
}

/** What a build found before it was written or failed. */
export interface BuildFindings {
	readonly warnings: readonly Diagnostic[];
	readonly syncWarnings: readonly Diagnostic[] | undefined;
}

interface Located {
	/** An absolute POSIX path. */
	readonly source: string;
	/** Whether the path is there now, rather than only placed as it would be once created. */
	readonly exists: boolean;
}

export interface PlacedLocation extends Located {
	readonly status: "placed";
	readonly instancePath: readonly string[];
	/** The other nodes an init script is, where its folder becomes a node in another route; only a copied init script has them. */
	readonly alsoAt?: readonly (readonly string[])[];
	readonly route: string;
	readonly routeMatch: RouteMatch;
	/** The active variants the file carries. */
	readonly variants: readonly VariantMatch[];
	/** A `^` on its name or a folder's took it straight to the route's target. */
	readonly hoisted?: boolean;
	/** The path was named as a file, and not found in a folder or behind an instance. */
	readonly named?: true;
}

export interface UnplacedLocation extends Located {
	/** `ignored` exists but isn't an instance. */
	readonly status: "outside" | "ignored" | "missing" | "empty";
	/** A `missing` path that is named as a folder, by ending in a separator. */
	readonly folder?: true;
}

/** Where a path lands in the tree, or why it lands nowhere. */
export type FileLocation =
	PlacedLocation | (LeftOut & Located) | UnplacedLocation;

/** The files placed at an instance or inside it; none when no file places it. */
export interface InstanceLocation {
	readonly reference: InstanceReference;
	readonly files: readonly PlacedLocation[];
	/** When no file places it: the absolute POSIX folders a new file for it goes in. */
	readonly folders: readonly string[];
	/** When no file places it: the renames of files that would, from the diagnostics that propose them. */
	readonly fixes: readonly InstanceFix[];
}

/** A rename, proposed by the diagnostic `code`, after which a file places the instance. Paths are absolute POSIX. */
export interface InstanceFix {
	readonly code: string;
	readonly rename: DiagnosticFix["rename"];
}

/** Where `locate` found things in one config. */
export interface ConfigLocations {
	readonly config: ResolvedConfig;
	/** One per path argument; every file when no argument was given. */
	readonly files: readonly FileLocation[];
	/** One per instance argument. */
	readonly instances: readonly InstanceLocation[];
	/** What a build of the config raises, without the sync dir's: the errors that stopped the later phases, else the warnings. */
	readonly diagnostics: readonly Diagnostic[];
}

/** What a sync tool writes in place of a `.meta.json`. */
export interface MetaReplacement {
	readonly suffix: string;
	/** Says why, in the warning about the meta Rojo no longer applies. */
	readonly note: string;
}

/** What a sync tool does to a data file: it writes a Lua module in its place, which Rojo syncs as a ModuleScript. */
export interface DataReplacement {
	/** What the module's name ends in instead of the data file's extension. */
	readonly suffix: string;
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
	/** A script name the tool writes as Rojo's `init`, which makes the file its folder too. */
	readonly initName?: string;
	/** What it writes instead of a `.meta.json`, which Rojo then no longer applies. */
	readonly metaReplacement?: MetaReplacement;
	/** What it writes instead of a data file, such as a `.txt`, which Rojo then no longer finds. */
	readonly dataReplacement?: DataReplacement;
}

/** What `locate` found, config by config. */
export interface Locations {
	/** No path or instance was asked about, so `files` holds every file. */
	readonly everyFile: boolean;
	/** The configs that load; each answers for itself. */
	readonly configs: readonly ConfigLocations[];
	/** Why the configs that didn't load did not answer. */
	readonly errors: readonly Diagnostic[];
}

/** The project file a config writes, and the staging files its writes go through. */
export class OutputFile {
	constructor(readonly path: string) {}

	/** The file one write stages its content in; `token` keeps concurrent writers apart. */
	stagingFile(token: string): string {
		return `${this.path}.${token}.tmp`;
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

/** The diagnostics about `source`, each narrowed to it: a grouped one becomes the entry of its `related` that names `source`, with only the fixes that rename it. */
export function diagnosticsAbout(
	diagnostics: readonly Diagnostic[],
	source: string
): Diagnostic[] {
	const target = toPosix(source);
	return diagnostics.flatMap((diagnostic): Diagnostic[] => {
		const { related, ...rest } = diagnostic;
		const entries = (related ?? []).filter(
			({ resource }) => toPosix(resource) === target
		);
		if (entries.length > 0)
			return entries.map(({ message }) => ({
				...rest,
				resource: source,
				position: undefined,
				message,
				fixes: diagnostic.fixes?.filter(
					({ rename }) => toPosix(rename.from) === target
				),
			}));
		// A group is about its related files; its own resource is the config.
		return !related?.length && toPosix(diagnostic.resource) === target
			? [rest]
			: [];
	});
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

/** The configs a run builds together, and the one rule for which of them can't be: one that declares no routes, or several that write one file. */
export class BuildSet {
	private readonly blockers: readonly Blocker[];

	constructor(readonly configs: readonly ResolvedConfig[]) {
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

	/** The configs of `selection` when every one is valid now and they can be built together; otherwise every error. */
	static of(selection: ConfigSelection): Result<BuildSet, DiagnosticsError> {
		const configs = selection.requireValid();
		if (configs.isErr()) return configs;
		const set = new BuildSet(configs.value);
		return set.diagnostics.length > 0
			? err(new DiagnosticsError([...set.diagnostics]))
			: ok(set);
	}

	/** Each problem once, in the order it is reported. */
	get diagnostics(): readonly Diagnostic[] {
		return this.blockers.map(({ diagnostic }) => diagnostic);
	}

	/** The config files some problem blocks. */
	get blockedFiles(): ReadonlySet<string> {
		return new Set(this.blockers.flatMap(({ files }) => files));
	}

	/** The problems that block the config file `file`; none when it can be built. */
	blocking(file: string): readonly Diagnostic[] {
		return this.blockers
			.filter(({ files }) => files.includes(file))
			.map(({ diagnostic }) => diagnostic);
	}

	configOf(file: string): ResolvedConfig | undefined {
		return this.configs.find((config) => config.file === file);
	}
}
