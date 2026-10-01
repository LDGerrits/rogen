import { Event } from "../../base/event.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic, isError } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ParsedArgs } from "../../platform/environment/args.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ResolvedConfig } from "./config.js";

/** A config file whose resolved value changed. */
export interface ConfigChangeEvent {
	/** The config file. */
	readonly resource: string;
}

/** Per-invocation values that sit above every layer of a config's chain. */
export interface ConfigOverrides {
	readonly outFile?: string;
	readonly syncDir?: string;
	readonly template?: string;
	/** Tag name to whether it is on. */
	readonly tags: Readonly<Record<string, boolean>>;
}

export interface ConfigRefs {
	readonly names: readonly string[];
	readonly paths: readonly string[];
	/** Every config in the working directory, instead of names or paths. */
	readonly all?: boolean;
	readonly overrides?: ConfigOverrides;
}

/** The configs `names` and the command line's flags pick, and the overrides those flags set. */
export function configRefsFromArgs(
	args: ParsedArgs,
	names: readonly string[]
): ConfigRefs {
	return {
		names,
		paths: args.config ?? [],
		all: args.all === true,
		overrides: {
			outFile: args["out-file"],
			syncDir: args["sync-dir"],
			template: args.template,
			tags: {
				...Object.fromEntries(
					(args.tag ?? []).map((tag) => [tag, true])
				),
				...Object.fromEntries(
					(args["no-tag"] ?? []).map((tag) => [tag, false])
				),
			},
		},
	};
}

/** A snapshot of one config; a later reload replaces it rather than mutating it. */
export class ConfigEntry {
	readonly file: string;
	readonly chain: readonly string[];
	/** The last valid version, or `undefined` if the config has never been valid. */
	readonly resolved: ResolvedConfig | undefined;
	readonly diagnostics: readonly Diagnostic[];
	/** Tags turned on or off from the command line that this config doesn't declare. */
	readonly skippedTags: readonly string[];
	readonly errors: readonly Diagnostic[];

	constructor(
		fields: Pick<
			ConfigEntry,
			"file" | "chain" | "resolved" | "diagnostics" | "skippedTags"
		>
	) {
		this.file = fields.file;
		this.chain = fields.chain;
		this.resolved = fields.resolved;
		this.diagnostics = fields.diagnostics;
		this.skippedTags = fields.skippedTags;
		this.errors = fields.diagnostics.filter(isError);
	}

	/** The configs it extends, the nearest first. */
	get parents(): readonly string[] {
		return this.chain.slice(1);
	}

	/** Whether the file is broken now, or there is no valid version of it to build. */
	get isBroken(): boolean {
		return this.errors.length > 0 || this.resolved === undefined;
	}
}

/** A config that resolved, with the entry it came from. */
export interface ResolvedEntry {
	readonly entry: ConfigEntry;
	readonly config: ResolvedConfig;
}

/** The entries that resolved, or every error when any entry is broken now. Warnings don't fail it. */
export function requireValidEntries(
	entries: readonly ConfigEntry[]
): Result<ResolvedEntry[], DiagnosticsError> {
	const errors = entries.flatMap((entry) => entry.errors);
	return errors.length > 0
		? err(new DiagnosticsError(errors))
		: ok(
				entries.flatMap((entry) =>
					entry.resolved ? [{ entry, config: entry.resolved }] : []
				)
			);
}

export interface ConfigService {
	readonly _serviceBrand: undefined;
	/** Fires once per config whose resolved value changed; `resource` is the config file. */
	readonly onDidChangeConfig: Event<ConfigChangeEvent>;

	readonly configs: readonly ConfigEntry[];
	readonly files: ReadonlySet<string>;

	/** The entry for the config file `file`, if this run selected it. */
	getConfig(file: string): ConfigEntry | undefined;
	/** The configs that resolved, each with the entry it came from. A broken config that was valid before is still here, as its last valid version. */
	getResolvedEntries(): ResolvedEntry[];
	/** What a command that reports on every config ends with when some are broken, or `undefined` when none are. */
	getBrokenError(): Error | undefined;

	/** Fails only when the configs cannot be found; a broken config lands on its entry. */
	initialize(refs: ConfigRefs): Promise<Result<void, Error>>;
	/** Every `*.rogen.json` directly in the working dir, loaded or not, as sorted absolute paths; none when it can't be read. */
	listConfigFiles(): Promise<string[]>;
	/** The config files `listConfigFiles` finds that this run didn't select, as sorted absolute paths. */
	listUnselectedConfigFiles(): Promise<string[]>;
	/** Loads one config file the way `initialize` would, without adding it to the configs. A broken config lands on the entry. */
	readConfig(file: string): Promise<ConfigEntry>;
	/** Reloads every config that reads one of `files`. A failed reload keeps the last valid value. */
	reload(files: readonly string[]): Promise<void>;
}

export const ConfigService =
	createServiceIdentifier<ConfigService>("configService");
