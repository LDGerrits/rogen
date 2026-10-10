import { toPosix } from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig, configLabel } from "../config/config.js";

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
	| { readonly status: "skipped" }
	/** Rojo ignores it, since only the letter case of its extension keeps it from being read; `rename` is the file name that Rojo reads. */
	| { readonly status: "extensionCase"; readonly rename: string };

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
