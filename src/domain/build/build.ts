import { toPosix } from "../../base/path.js";
import {
	Diagnostic,
	diagnosticKey,
} from "../../platform/diagnostics/diagnostic.js";
import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { configLabel } from "../config/config.js";
import { ConfigSelection, buildableConfigs } from "../config/config-service.js";

type MatchForm = "folder" | "marker" | "suffix";

/** How the governing route matched the file; `init` is the route suffix of an init script in one of its folders, `copy` an init script placed where its folder's other files route it, and `fallback` the `*` route. */
export type RouteMatch = MatchForm | "init" | "copy" | "fallback";

/** Why the scan left a path out; the path is the key it is stored under. */
export type ScanLeftOut =
	| { readonly status: "ignored"; readonly pattern: string }
	/** The tree mounts it with a `$path` at `node`, so Rojo reads it and Rogen leaves it alone. */
	| { readonly status: "mounted"; readonly node: readonly string[] }
	/** It lies in a folder that holds a `default.project.json`, which Rojo reads as the whole folder. */
	| { readonly status: "inProject"; readonly project: string }
	/** A link that loops back to an ancestor or points at nothing. */
	| { readonly status: "skipped" }
	/** Rojo ignores it because of the letter case of its extension; `rename` is the file name that Rojo reads. */
	| { readonly status: "extensionCase"; readonly rename: string };

/** Why the build leaves a path out of the tree, in the words `where` reports it. */
export type LeftOut =
	| ScanLeftOut
	| { readonly status: "unrouted" }
	| { readonly status: "replaced"; readonly by: string }
	/** The tree defines the node it would be, or a `$path` above it. */
	| { readonly status: "displaced"; readonly node: readonly string[] };

interface RootSummary {
	readonly sourcePath: string;
	readonly files: number;
	readonly ignored: number;
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
	readonly displaced: number;
}

export function isWritten(build: ConfigBuild): build is WrittenBuild {
	return build.outcome === "wrote" || build.outcome === "unchanged";
}

/** What a run did for a config that loaded; narrow it on `outcome`. */
export type LoadedBuild =
	WrittenBuild | CheckedBuild | UnwrittenBuild | FailedBuild;

/** What a run did for one selected config; one that didn't load has no `config`. */
export type ConfigBuild = LoadedBuild | UnloadedBuild;

abstract class AbstractConfigBuild {
	constructor(
		readonly config: ResolvedConfig,
		private readonly findings: BuildFindings,
		/** Why it failed; none unless it did. */
		readonly errors: readonly Diagnostic[] = []
	) {}

	get label(): string {
		return this.config.label;
	}

	get file(): string {
		return this.config.file;
	}

	get warnings(): readonly Diagnostic[] {
		return this.findings.warnings;
	}

	/** What the compiled path check found for this version of the config; `undefined` while unknown. */
	get syncWarnings(): readonly Diagnostic[] | undefined {
		return this.findings.syncWarnings;
	}

	/** Everything the build has to say, in the order it is printed: warnings, compiled path warnings, then the errors that failed it. */
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
		readonly summary: BuildSummary,
		/** The files the build read; a change to one must rebuild it. */
		readonly readFiles: readonly string[]
	) {
		super(config, findings);
	}
}

/** A config that didn't load, so there was nothing to build; `errors` is why. */
export class UnloadedBuild {
	readonly outcome = "notLoaded";

	constructor(
		readonly file: string,
		readonly errors: readonly Diagnostic[]
	) {}

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

/** A config that built cleanly in a run that writes nothing, and that a run which writes would have written. */
export class CheckedBuild extends AbstractConfigBuild {
	readonly outcome = "wouldWrite";

	constructor(
		config: ResolvedConfig,
		findings: BuildFindings,
		readonly summary: BuildSummary,
		readonly readFiles: readonly string[]
	) {
		super(config, findings);
	}
}

/** A config that built cleanly, but whose run stopped before writing it because the configs whose files `blockedBy` lists failed or didn't load. */
export class UnwrittenBuild extends AbstractConfigBuild {
	readonly outcome = "notWritten";

	constructor(
		config: ResolvedConfig,
		findings: BuildFindings,
		readonly summary: BuildSummary,
		readonly readFiles: readonly string[],
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

export interface BuildFindings {
	readonly warnings: readonly Diagnostic[];
	readonly syncWarnings: readonly Diagnostic[] | undefined;
}

interface SharedPart {
	readonly fresh: readonly Diagnostic[];
	/** The files of the earlier configs that raised all of them, when the config added none; empty otherwise. */
	readonly sameAs: readonly string[];
}

/** The diagnostics of one kind a run's configs raised, so a config that repeats one adds nothing for it. */
export class SharedDiagnostics {
	private readonly raisedBy = new Map<string, string>();

	private constructor(private readonly sameAcrossConfigs: boolean) {}

	static errors(): SharedDiagnostics {
		return new SharedDiagnostics(false);
	}

	static warnings(): SharedDiagnostics {
		return new SharedDiagnostics(true);
	}

	/** Splits `diagnostics` of the config at `configFile` into those no config raised yet and the config files that raised the rest. */
	take(configFile: string, diagnostics: readonly Diagnostic[]): SharedPart {
		const owners = new Set<string>();
		const fresh = diagnostics.filter((diagnostic) => {
			const key = diagnosticKey(
				diagnostic,
				this.sameAcrossConfigs ? configFile : undefined
			);
			const owner = this.raisedBy.get(key);
			if (owner === undefined) this.raisedBy.set(key, configFile);
			else if (owner !== configFile) owners.add(owner);
			return owner === undefined;
		});
		return {
			fresh,
			sameAs:
				diagnostics.length > 0 && fresh.length === 0 ? [...owners] : [],
		};
	}
}

interface BuildShare {
	readonly build: ConfigBuild;
	readonly warnings: SharedPart;
	readonly errors: SharedPart;
}

/** The builds of one run, one per selected config in order; a warning several configs share, or an error a config repeats, is said once, by the first. */
export class BuildRun {
	readonly shares: readonly BuildShare[];

	constructor(readonly builds: readonly ConfigBuild[]) {
		const warnings = SharedDiagnostics.warnings();
		const errors = SharedDiagnostics.errors();
		this.shares = builds.map((build) => ({
			build,
			warnings: warnings.take(build.file, [
				...build.warnings,
				...(build.syncWarnings ?? []),
			]),
			errors: errors.take(build.file, build.errors),
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

	/** The warnings the run says, one several configs share counted once: what the closing line says. */
	get warningCount(): number {
		return this.shares.reduce(
			(count, { warnings }) => count + warnings.fresh.length,
			0
		);
	}

	/** Why the run fails: its errors. */
	failure(): Error | undefined {
		return this.errors.length > 0
			? new DiagnosticsError(this.errors)
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
					entry.status === "valid" ? buildableConfigs(entry) : []
				)
			),
			unloaded: selection.entries.flatMap((entry) =>
				entry.status === "broken"
					? [new UnloadedBuild(entry.file, entry.errors)]
					: []
			),
		};
	}

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
