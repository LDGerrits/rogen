import path from "path";
import { groupBy } from "../../base/collections.js";
import { toPosix } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
	diagnosticKey,
} from "../../platform/diagnostics/diagnostic.js";
import { Result, err, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig, configLabel } from "../config/config.js";
import { ConfigSelection } from "../config/config-service.js";

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

/** Whether `build` wrote its project file, or found it unchanged. */
export function isWritten(build: ConfigBuild): build is WrittenBuild {
	return build.outcome === "wrote" || build.outcome === "unchanged";
}

/** What a run did for a config that loaded: the one record the build, the watch and every presenter read. Narrow it on `outcome`; each kind holds what its outcome has. */
export type LoadedBuild = WrittenBuild | UnwrittenBuild | FailedBuild;

/** What a run did for one selected config; one that didn't load has no `config`. */
export type ConfigBuild = LoadedBuild | UnloadedBuild;

/** What every kind of config build holds. */
abstract class AbstractConfigBuild {
	constructor(
		readonly config: ResolvedConfig,
		private readonly findings: BuildFindings,
		/** Why it failed; none unless it did. */
		readonly errors: readonly Diagnostic[] = []
	) {}

	/** What the config is asked for by. */
	get label(): string {
		return this.config.label;
	}

	/** The config file. */
	get file(): string {
		return this.config.file;
	}

	get warnings(): readonly Diagnostic[] {
		return this.findings.warnings;
	}

	/** What the sync dir check found for this version of the config, whether this build checked it or the previous one did; `undefined` while unknown. */
	get syncWarnings(): readonly Diagnostic[] | undefined {
		return this.findings.syncWarnings;
	}

	/** Everything the build has to say, in the order it is printed: warnings, sync dir warnings, then the errors that failed it. */
	get diagnostics(): readonly Diagnostic[] {
		return [...this.warnings, ...(this.syncWarnings ?? []), ...this.errors];
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
}

/** A config whose build, write or set check went wrong; `findings` is what its build found before that. */
export class FailedBuild extends AbstractConfigBuild {
	readonly outcome = "failed";

	constructor(
		config: ResolvedConfig,
		errors: readonly Diagnostic[],
		findings: BuildFindings = { warnings: [], syncWarnings: undefined }
	) {
		super(config, findings, errors);
	}

	/** A config that failed before it had warnings of its own; `syncWarnings` is what an earlier build of this version found. */
	static before(
		config: ResolvedConfig,
		errors: readonly Diagnostic[],
		syncWarnings?: readonly Diagnostic[]
	): FailedBuild {
		return new FailedBuild(config, errors, { warnings: [], syncWarnings });
	}
}

/** What a build found before it was written or failed. */
export interface BuildFindings {
	readonly warnings: readonly Diagnostic[];
	readonly syncWarnings: readonly Diagnostic[] | undefined;
}

/** What one config adds to a run's diagnostics of one kind. */
export interface SharedPart {
	/** The diagnostics no earlier config raised. */
	readonly fresh: readonly Diagnostic[];
	/** The earlier configs that raised every one of them, when it had some and added none; empty otherwise. */
	readonly sameAs: readonly string[];
}

/** The diagnostics of one kind a run's configs raised, so a config that repeats one adds nothing for it. */
export class SharedDiagnostics {
	private readonly raisedBy = new Map<string, string>();

	private constructor(
		/** Whether a diagnostic about a config's own file equals another config's. */
		private readonly sameAcrossConfigs: boolean
	) {}

	static errors(): SharedDiagnostics {
		return new SharedDiagnostics(false);
	}

	/** Configs that read one folder find the same warnings, each filed under its own config. */
	static warnings(): SharedDiagnostics {
		return new SharedDiagnostics(true);
	}

	/** Splits `diagnostics` of the config `label`, whose file is `configFile`, into those no config raised yet and the configs that raised the rest. */
	take(
		label: string,
		configFile: string,
		diagnostics: readonly Diagnostic[]
	): SharedPart {
		const owners = new Set<string>();
		const fresh = diagnostics.filter((diagnostic) => {
			const key = diagnosticKey(
				diagnostic,
				this.sameAcrossConfigs ? configFile : undefined
			);
			const owner = this.raisedBy.get(key);
			if (owner === undefined) this.raisedBy.set(key, label);
			else if (owner !== label) owners.add(owner);
			return owner === undefined;
		});
		return {
			fresh,
			sameAs:
				diagnostics.length > 0 && fresh.length === 0 ? [...owners] : [],
		};
	}
}

/** One build of a run, with what it adds to the run's warnings and errors. */
export interface BuildShare {
	readonly build: ConfigBuild;
	/** Its warnings, then its sync dir's. */
	readonly warnings: SharedPart;
	readonly errors: SharedPart;
}

/** The builds of one run, one per selected config in order, and what the run says: a warning several configs share, or an error a config repeats, is said once, by the first. The output, `--deny-warnings` and `check` all count this way. */
export class BuildRun {
	readonly shares: readonly BuildShare[];

	constructor(readonly builds: readonly ConfigBuild[]) {
		const warnings = SharedDiagnostics.warnings();
		const errors = SharedDiagnostics.errors();
		this.shares = builds.map((build) => ({
			build,
			warnings: warnings.take(build.label, build.file, [
				...build.warnings,
				...(build.syncWarnings ?? []),
			]),
			errors: errors.take(build.label, build.file, build.errors),
		}));
	}

	/** Whether a config failed or didn't load, which writes nothing. */
	get failed(): boolean {
		return this.builds.some(
			({ outcome }) => outcome === "failed" || outcome === "notLoaded"
		);
	}

	/** Every error of every config, repeats included: what the run fails with. */
	get errors(): Diagnostic[] {
		return this.builds.flatMap(({ errors }) => errors);
	}

	/** The warnings the run says, one several configs share counted once: what `--deny-warnings` counts. */
	get warningCount(): number {
		return this.shares.reduce(
			(count, { warnings }) => count + warnings.fresh.length,
			0
		);
	}

	/** Why the run fails: an error, or, when warnings are denied, a warning it says. */
	failure(denyWarnings: boolean): Error | undefined {
		if (this.errors.length > 0) return new DiagnosticsError(this.errors);
		return denyWarnings && this.warningCount > 0
			? new Error(
					`${plural(this.warningCount, "warning")} denied by --deny-warnings.`
				)
			: undefined;
	}

	/** What the run says, config by config: its fresh warnings, then its fresh errors. */
	get diagnostics(): Diagnostic[] {
		return this.shares.flatMap(({ warnings, errors }) => [
			...warnings.fresh,
			...errors.fresh,
		]);
	}
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

/** Nothing can be placed without a route. */
function missingRoutes(config: ResolvedConfig): Diagnostic[] {
	return config.routes.size > 0
		? []
		: [
				errorDiagnostic(
					"route.noRoutes",
					{ resource: config.file },
					"no routes declared, so nothing can be placed.\nAdd a \"routes\" map; 'rogen init' writes a starting set."
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

	/** The valid configs of `selection` as a set, and the others as builds that didn't load; fails when a set's problem or a config's own error stops the run. */
	static partition(
		selection: ConfigSelection
	): Result<
		{ readonly set: BuildSet; readonly unloaded: UnloadedBuild[] },
		DiagnosticsError
	> {
		const unloaded = selection.entries.flatMap((entry) =>
			entry.status === "broken"
				? [new UnloadedBuild(entry.file, entry.errors)]
				: []
		);
		const set = new BuildSet(
			selection.entries.flatMap((entry) =>
				entry.status === "valid" ? [entry.config] : []
			)
		);
		return set.diagnostics.length > 0
			? err(
					new DiagnosticsError([
						...unloaded.flatMap(({ errors }) => errors),
						...set.diagnostics,
					])
				)
			: ok({ set, unloaded });
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

	/** Every root directory of every config, which one listing covers. */
	get rootDirs(): string[] {
		return this.configs.flatMap(({ rootDirs }) => rootDirs);
	}
}
