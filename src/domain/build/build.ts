import { toPosix } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import {
	Diagnostic,
	diagnosticKey,
} from "../../platform/diagnostics/diagnostic.js";
import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { configLabel } from "../config/config.js";
import {
	ConfigSelection,
	buildableProjects,
} from "../config/config-service.js";

/** How a route key matched a file by its name. */
type MatchForm = "folder" | "marker" | "suffix";

/** How the governing route matched the file; `init` is the route suffix of an init script in one of its folders, `copy` an init script placed where its folder's other files route it, and `fallback` the `*` route. */
export type RouteMatch = MatchForm | "init" | "copy" | "fallback";

/** Why the scan left a path out; the path is the key it is stored under. */
export type ScanLeftOut =
	| { readonly status: "ignored"; readonly pattern: string }
	/** The tree mounts it with a `$path` at `node`, so Rojo reads it and Rogen leaves it alone. */
	| { readonly status: "mounted"; readonly node: readonly string[] }
	/** A link that loops back to an ancestor or points at nothing, which Rojo must never walk. */
	| { readonly status: "skipped" }
	/** Rojo ignores it, since only the letter case of its extension keeps it from being read; `rename` is the file name that Rojo reads. */
	| { readonly status: "extensionCase"; readonly rename: string };

/** Why the build leaves a path out of the tree, in the words `where` reports it. */
export type LeftOut =
	| ScanLeftOut
	/** No route governs it. */
	| { readonly status: "unrouted" }
	/** Another file took its instance path. */
	| { readonly status: "replaced"; readonly by: string }
	/** The tree defines the node it would be, or a `$path` above it. */
	| { readonly status: "displaced"; readonly node: readonly string[] };

interface RootSummary {
	readonly sourcePath: string;
	readonly files: number;
	readonly ignored: number;
	/** Paths the tree mounts, which Rojo reads instead. */
	readonly mounted: number;
	readonly skippedLinks: number;
}

interface RouteSummary {
	readonly key: string;
	readonly target: string;
	readonly files: number;
}

export interface BuildSummary {
	readonly roots: readonly RootSummary[];
	/** In the order the config declares them. */
	readonly routes: readonly RouteSummary[];
	readonly unrouted: number;
	readonly replaced: number;
	/** Left out because the tree defines their node. */
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

	/** The config file the user names it by: the one that lists it, for a place. */
	get rootFile(): string {
		return this.config.rootFile;
	}

	get warnings(): readonly Diagnostic[] {
		return this.findings.warnings;
	}

	/** What the sync path check found for this version of the config, whether this build checked it or the previous one did; `undefined` while unknown. */
	get syncWarnings(): readonly Diagnostic[] | undefined {
		return this.findings.syncWarnings;
	}

	/** Everything the build has to say, in the order it is printed: warnings, sync path warnings, then the errors that failed it. */
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

	get rootFile(): string {
		return this.file;
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
interface SharedPart {
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

	/** Configs that read the same source paths find the same warnings, each filed under its own config. */
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
interface BuildShare {
	readonly build: ConfigBuild;
	/** Its warnings, then its sync path's. */
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

/** The configs a run builds together. */
export class BuildSet {
	constructor(readonly configs: readonly ResolvedConfig[]) {}

	/** The configs of `selection` when every one is valid now; otherwise every error. */
	static of(selection: ConfigSelection): Result<BuildSet, DiagnosticsError> {
		return selection.requireValid().map((configs) => new BuildSet(configs));
	}

	/** The configs of `selection` that load, as a set, and the others as builds that didn't. */
	static partition(selection: ConfigSelection): {
		readonly set: BuildSet;
		readonly unloaded: readonly UnloadedBuild[];
	} {
		return {
			set: new BuildSet(
				selection.entries.flatMap((entry) =>
					entry.status === "valid" ? buildableProjects(entry) : []
				)
			),
			unloaded: selection.entries.flatMap((entry) =>
				entry.status === "broken"
					? [new UnloadedBuild(entry.file, entry.errors)]
					: []
			),
		};
	}

	/** The project that is written to `projectFile`. */
	configOf(projectFile: string): ResolvedConfig | undefined {
		return this.configs.find(
			(config) => config.projectFile === projectFile
		);
	}

	/** Every folder of every config that one listing covers. */
	get indexedPaths(): string[] {
		return this.configs.flatMap(({ indexedPaths }) => indexedPaths);
	}
}
