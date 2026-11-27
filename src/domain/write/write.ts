import { toPosix } from "../../base/path.js";
import {
	Diagnostic,
	DiagnosticSeverity,
	isError,
	diagnosticKey,
} from "../../platform/diagnostics/diagnostic.js";
import { plural, unlistedNote } from "../../base/strings.js";
import { WHERE_SCRIPTS_RUN } from "../roblox/roblox.js";
import { Result } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ConfigSelection, validConfigs } from "../config/config-service.js";

const INVISIBLE_FOLDER = /^\((.+)\)$/;

export function unwrapInvisibleFolder(folderName: string): {
	readonly name: string;
	readonly invisible: boolean;
} {
	const inner = INVISIBLE_FOLDER.exec(folderName)?.[1];
	return inner === undefined
		? { name: folderName, invisible: false }
		: { name: inner, invisible: true };
}

export function unhoisted(name: string): {
	readonly name: string;
	readonly hoisted: boolean;
} {
	return name.length > 1 && name.startsWith("^")
		? { name: name.slice(1), hoisted: true }
		: { name, hoisted: false };
}

export function readFolderName(written: string): {
	readonly name: string;
	readonly invisible: boolean;
	readonly hoisted: boolean;
	readonly offset: number;
} {
	const outer = unwrapInvisibleFolder(written);
	const hoisted = unhoisted(outer.name);
	const inner = hoisted.hoisted
		? unwrapInvisibleFolder(hoisted.name)
		: { name: hoisted.name, invisible: false };
	const invisible = outer.invisible || inner.invisible;
	return {
		name: inner.name,
		invisible,
		hoisted: hoisted.hoisted,
		offset: (invisible ? 1 : 0) + (hoisted.hoisted ? 1 : 0),
	};
}

const TRAILING_AT = /@([A-Za-z][A-Za-z0-9]*)(?:\.[^@]*)?$/;

const wordAfterAt = (name: string): string[] =>
	TRAILING_AT.exec(name)?.slice(1) ?? [];

export function routeWordsOf(name: string, kind: "file" | "folder"): string[] {
	if (kind === "file") return wordAfterAt(name);
	const { name: bare } = readFolderName(name);
	return [bare, ...wordAfterAt(bare)];
}

const ROUTE_RESPELLING_CODES: ReadonlySet<string> = new Set([
	"route.caseMismatch",
	"route.strayAt",
]);

export const isRouteRespelling = ({ code }: Diagnostic): boolean =>
	ROUTE_RESPELLING_CODES.has(code);

const STUDIO_RENAMING_CODES: ReadonlySet<string> = new Set([
	"tree.instanceClash",
	"route.caseMismatch",
	"route.ignoredAt",
]);

export const isFixedByRenaming = ({ code }: Diagnostic): boolean =>
	STUDIO_RENAMING_CODES.has(code);

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

export class WrittenConfig extends AbstractConfigOutcome {
	constructor(
		config: ResolvedConfig,
		readonly kind: "wrote" | "unchanged",
		findings: WriteFindings,
		readonly summary: WriteSummary,
		readonly readFiles: readonly string[]
	) {
		super(config, findings);
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

	get changed(): boolean {
		return this.outcomes.some(didWrite);
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

const LISTED_PER_CODE = 10;

interface DiagnosticGroup {
	readonly headline: (count: number) => string;
	readonly tail?: (count: number) => string;
	readonly item?: (message: string) => string;
}

const either = (count: number, one: string, many: string) =>
	count === 1 ? one : many;

const GROUPS: Readonly<Record<string, DiagnosticGroup>> = {
	"scan.sourcePathNamedAfterKey": {
		headline: (count) =>
			`${count} source ${either(count, "path is", "paths are")} named after a route key, so ${either(count, "its name routes", "their names route")} nothing:`,
	},
	"route.strayAt": {
		headline: (count) =>
			`${count} ${either(count, "name has", "names have")} an "@" that misses its route, so Rogen stops until ${either(count, "it is", "they are")} fixed:`,
	},
	"route.dotRoute": {
		headline: (count) =>
			`${count} ${either(count, "name writes", "names write")} a route key after a dot, where only "@" routes, so Rogen stops until ${either(count, "it is", "they are")} fixed:`,
	},
	"route.patternClash": {
		headline: (count) =>
			`${plural(count, "file")} ${either(count, "matches", "match")} patterns as long as each other that send ${either(count, "it", "them")} to different places:`,
		item: (message) => {
			const end = message.indexOf(" both match");
			return end > 0 ? message.slice(0, end) : message;
		},
		tail: () =>
			"Lengthen the pattern that should win, or route the file with a folder or an @ name.",
	},
	"route.serverCodeShipped": {
		headline: (count) =>
			`${plural(count, "file")} in a folder named for a server route ${either(count, "ships", "ship")} to clients:`,
	},
	"tree.deadScript": {
		headline: (count) =>
			`${plural(count, "script")} will never run where ${either(count, "it lands", "they land")}:`,
		tail: () => WHERE_SCRIPTS_RUN,
	},
	"tree.runContextTarget": {
		headline: (count) =>
			`emitLegacyScripts: false makes ${either(count, "a client script", "client scripts")} in StarterPlayerScripts or StarterCharacterScripts ${either(count, "a Script", "Scripts")} with RunContext Client, which ${either(count, "runs", "run")} twice there:`,
		tail: () =>
			"Route client scripts to ReplicatedStorage, or remove emitLegacyScripts from the config.",
	},
	"tree.mountClash": {
		headline: (count) =>
			`${count} ${either(count, "file sits", "files sit")} next to an instance of the same name that a mount of the tree holds, so Rojo builds two of ${either(count, "it", "each")}:`,
		tail: (count) =>
			`Rename one of ${either(count, "them", "each pair")}, or route outside the mounted folder.`,
	},
};

function block(
	run: readonly Diagnostic[],
	group: DiagnosticGroup,
	file: string
): Diagnostic {
	const [{ severity, code }] = run;
	const unlisted = run.length - LISTED_PER_CODE;
	return {
		severity,
		code,
		resource: file,
		message: [
			group.headline(run.length),
			...run
				.slice(0, LISTED_PER_CODE)
				.map(
					({ resource, message }) =>
						`  ${resource} (${group.item ? group.item(message) : message})`
				),
			...(unlisted > 0 ? [`  ${unlistedNote(unlisted)}`] : []),
			...(group.tail ? [group.tail(run.length)] : []),
		].join("\n"),
	};
}

function grouped(
	diagnostics: readonly Diagnostic[],
	file: string
): Diagnostic[] {
	const printed: Diagnostic[] = [];
	for (let start = 0; start < diagnostics.length;) {
		const { code } = diagnostics[start];
		let end = start + 1;
		while (end < diagnostics.length && diagnostics[end].code === code)
			end++;
		const group = GROUPS[code];
		printed.push(
			...(group
				? [block(diagnostics.slice(start, end), group, file)]
				: diagnostics.slice(start, end))
		);
		start = end;
	}
	return printed;
}

const noted = (diagnostic: Diagnostic, note: string): Diagnostic => ({
	...diagnostic,
	message: `${diagnostic.message} ${note}`,
});

function capped(diagnostics: readonly Diagnostic[]): Diagnostic[] {
	const totals = new Map<string, number>();
	const warnings = diagnostics.filter(
		({ severity }) => severity === DiagnosticSeverity.Warning
	);
	for (const { code } of warnings)
		totals.set(code, (totals.get(code) ?? 0) + 1);
	const seen = new Map<string, number>();
	return diagnostics.flatMap((diagnostic) => {
		if (diagnostic.severity !== DiagnosticSeverity.Warning)
			return [diagnostic];
		const { code } = diagnostic;
		const position = (seen.get(code) ?? 0) + 1;
		seen.set(code, position);
		if (position > LISTED_PER_CODE) return [];
		const unlisted = totals.get(code)! - LISTED_PER_CODE;
		return position === LISTED_PER_CODE && unlisted > 0
			? [noted(diagnostic, unlistedNote(unlisted))]
			: [diagnostic];
	});
}

export function diagnosticGroups(
	diagnostics: readonly Diagnostic[],
	file: string
): Diagnostic[] {
	return capped(grouped(diagnostics, file));
}
