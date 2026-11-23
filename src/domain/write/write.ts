import { toPosix } from "../../base/path.js";
import {
	Diagnostic,
	isError,
	diagnosticKey,
} from "../../platform/diagnostics/diagnostic.js";
import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ConfigSelection, validConfigs } from "../config/config-service.js";

type MatchForm = "folder" | "marker" | "suffix";

export type RouteMatch = MatchForm | "pattern" | "fallback";

export interface FolderNode {
	readonly folder: string;
	readonly instancePath: readonly string[];
}

export type ScanLeftOut =
	| { readonly status: "ignored"; readonly pattern: string }
	| { readonly status: "mounted"; readonly node: readonly string[] }
	| { readonly status: "inProject"; readonly project: string }
	| { readonly status: "skipped" }
	/**
	 * Rojo ignores it because of the letter case of its extension; `rename` is
	 * the file name that Rojo reads.
	 */
	| { readonly status: "extensionCase"; readonly rename: string };

export type LeftOut =
	| ScanLeftOut
	| { readonly status: "unrouted" }
	| { readonly status: "replaced"; readonly by: string }
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

export interface WriteSummary {
	readonly roots: readonly RootSummary[];
	readonly routes: readonly RouteSummary[];
	readonly unrouted: number;
	readonly replaced: number;
	readonly displaced: number;
}

export function isWritten(outcome: ConfigOutcome): outcome is WrittenConfig {
	return outcome.kind === "wrote" || outcome.kind === "unchanged";
}

export function isFailed<T extends object>(
	outcome: T
): outcome is Extract<T, FailedConfig | UnloadedConfig> {
	return outcome instanceof FailedConfig || outcome instanceof UnloadedConfig;
}

export const didWrite = (outcome: ConfigOutcome): boolean =>
	outcome.kind === "wrote";

export const isUnchanged = (outcome: ConfigOutcome): boolean =>
	outcome.kind === "unchanged";

export type LoadedConfig =
	WrittenConfig | CheckedConfig | UnwrittenConfig | FailedConfig;

export type ConfigOutcome = LoadedConfig | UnloadedConfig;

abstract class AbstractConfigOutcome {
	constructor(
		readonly config: ResolvedConfig,
		private readonly findings: WriteFindings,
		readonly errors: readonly Diagnostic[] = []
	) {}

	get file(): string {
		return this.config.file;
	}

	get warnings(): readonly Diagnostic[] {
		return this.findings.warnings;
	}

	get sync(): SyncWarnings {
		return this.findings.sync;
	}

	get syncWarnings(): readonly Diagnostic[] | undefined {
		return SyncWarnings.warningsOf(this.sync);
	}

	get diagnostics(): readonly Diagnostic[] {
		return [...this.warnings, ...(this.syncWarnings ?? []), ...this.errors];
	}

	withConfig(config: ResolvedConfig): this {
		return Object.assign(
			Object.create(Object.getPrototypeOf(this) as object) as this,
			this,
			{ config }
		);
	}
}

export interface OutputChange {
	readonly file: string;
	readonly change: "wrote" | "unchanged" | "removed";
}

export class WrittenConfig extends AbstractConfigOutcome {
	readonly outputs: readonly OutputChange[];

	constructor(
		config: ResolvedConfig,
		readonly kind: "wrote" | "unchanged",
		findings: WriteFindings,
		readonly summary: WriteSummary,
		readonly readFiles: readonly string[],
		outputs?: readonly OutputChange[]
	) {
		super(config, findings);
		this.outputs = outputs ?? [{ file: config.projectFile, change: kind }];
	}
}

export class UnloadedConfig {
	readonly kind = "notLoaded";

	constructor(
		readonly file: string,
		readonly errors: readonly Diagnostic[]
	) {}

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

export class CheckedConfig extends AbstractConfigOutcome {
	readonly kind = "wouldWrite";

	constructor(
		config: ResolvedConfig,
		findings: WriteFindings,
		readonly summary: WriteSummary,
		readonly readFiles: readonly string[]
	) {
		super(config, findings);
	}
}

export class UnwrittenConfig extends AbstractConfigOutcome {
	readonly kind = "notWritten";

	constructor(
		config: ResolvedConfig,
		findings: WriteFindings,
		readonly summary: WriteSummary,
		readonly readFiles: readonly string[],
		readonly blockedBy: readonly string[]
	) {
		super(config, findings);
	}
}

export class FailedConfig extends AbstractConfigOutcome {
	readonly kind = "failed";

	constructor(
		config: ResolvedConfig,
		errors: readonly Diagnostic[],
		findings: WriteFindings = { warnings: [], sync: SyncWarnings.unknown }
	) {
		super(config, findings, errors);
	}

	static before(
		config: ResolvedConfig,
		diagnostics: readonly Diagnostic[],
		sync: SyncWarnings
	): FailedConfig {
		return new FailedConfig(config, diagnostics.filter(isError), {
			warnings: diagnostics.filter((diagnostic) => !isError(diagnostic)),
			sync,
		});
	}
}

export type SyncWarnings =
	| { readonly kind: "unknown" }
	| { readonly kind: "deferred" }
	| { readonly kind: "known"; readonly warnings: readonly Diagnostic[] };

const unknown: SyncWarnings = { kind: "unknown" };
const deferred: SyncWarnings = { kind: "deferred" };

function known(warnings: readonly Diagnostic[]): SyncWarnings {
	return { kind: "known", warnings };
}

function warningsOf(sync: SyncWarnings): readonly Diagnostic[] | undefined {
	return sync.kind === "known" ? sync.warnings : undefined;
}

export const SyncWarnings = {
	unknown,
	deferred,
	known,
	warningsOf,
} as const;

export interface WriteFindings {
	readonly warnings: readonly Diagnostic[];
	readonly sync: SyncWarnings;
}

interface SharedPart {
	readonly fresh: readonly Diagnostic[];
	readonly sameAs: readonly string[];
}

export class SharedDiagnostics {
	private readonly raisedBy = new Map<string, string>();

	private constructor(private readonly sameAcrossConfigs: boolean) {}

	static errors(): SharedDiagnostics {
		return new SharedDiagnostics(false);
	}

	static warnings(): SharedDiagnostics {
		return new SharedDiagnostics(true);
	}

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

interface OutcomeShare {
	readonly outcome: ConfigOutcome;
	readonly warnings: SharedPart;
	readonly errors: SharedPart;
}

export class WriteRun {
	readonly shares: readonly OutcomeShare[];

	constructor(readonly outcomes: readonly ConfigOutcome[]) {
		const warnings = SharedDiagnostics.warnings();
		const errors = SharedDiagnostics.errors();
		this.shares = outcomes.map((outcome) => ({
			outcome,
			warnings: warnings.take(outcome.file, [
				...outcome.warnings,
				...(outcome.syncWarnings ?? []),
			]),
			errors: errors.take(outcome.file, outcome.errors),
		}));
	}

	get failed(): boolean {
		return this.outcomes.some(isFailed);
	}

	get errors(): Diagnostic[] {
		return this.outcomes.flatMap(({ errors }) => errors);
	}

	get warningCount(): number {
		return this.shares.reduce(
			(count, { warnings }) => count + warnings.fresh.length,
			0
		);
	}

	failure(): Error | undefined {
		return this.failed ? new DiagnosticsError(this.errors) : undefined;
	}

	get diagnostics(): Diagnostic[] {
		return this.shares.flatMap(({ warnings, errors }) => [
			...warnings.fresh,
			...errors.fresh,
		]);
	}
}

export class OutputFile {
	constructor(readonly path: string) {}

	stagingFile(token: string): string {
		return `${this.path}.${token}.tmp`;
	}

	get stagingPattern(): RegExp {
		const escaped = toPosix(this.path).replace(
			/[.*+?^${}()|[\]\\]/g,
			"\\$&"
		);
		return new RegExp(`^${escaped}\\.[^/]+\\.tmp$`);
	}
}

export class WriteSet {
	constructor(readonly configs: readonly ResolvedConfig[]) {}

	static of(selection: ConfigSelection): Result<WriteSet, DiagnosticsError> {
		return selection.requireValid().map((configs) => new WriteSet(configs));
	}

	static partition(selection: ConfigSelection): {
		readonly set: WriteSet;
		readonly unloaded: readonly UnloadedConfig[];
	} {
		return {
			set: new WriteSet(
				selection.entries.flatMap((entry) =>
					entry.status === "valid" ? validConfigs(entry) : []
				)
			),
			unloaded: selection.entries.flatMap((entry) =>
				entry.status === "broken"
					? [new UnloadedConfig(entry.file, entry.errors)]
					: []
			),
		};
	}

	configOf(projectFile: string): ResolvedConfig | undefined {
		return this.configs.find(
			(config) => config.projectFile === projectFile
		);
	}

	get indexedPaths(): string[] {
		return this.configs.flatMap(({ indexedPaths }) => indexedPaths);
	}
}
