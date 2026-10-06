import { Sequencer } from "../../base/async.js";
import { Result, err, ok } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	newDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "./config.js";
import { ConfigLoader, ConfigOverrides } from "./config-loader.js";
import { ManagedConfig } from "./managed-config.js";
import {
	ConfigEntry,
	ConfigNotice,
	ConfigReload,
	ConfigSelection,
	buildableConfig,
} from "./config-service.js";

const errorsOf = (entry: ConfigEntry): readonly Diagnostic[] =>
	entry.status === "broken" ? entry.errors : [];

/** The configs one invocation picked, each loading and reloading itself. */
export class CoreConfigSelection implements ConfigSelection {
	private readonly reloads = new Sequencer();
	private _files: ReadonlySet<string>;

	private constructor(
		private readonly managed: readonly ManagedConfig[],
		readonly unselected: readonly string[]
	) {
		this._files = this.readFiles();
	}

	/** Loads `files` with `overrides`; fails when a variant override is declared by none of them. */
	static async load(
		files: readonly string[],
		loader: ConfigLoader,
		overrides: ConfigOverrides,
		unselected: readonly string[]
	): Promise<Result<CoreConfigSelection, Error>> {
		const managed = files.map(
			(file) => new ManagedConfig(file, loader, overrides)
		);
		await Promise.all(managed.map((config) => config.load()));
		const problem = undeclaredVariant(managed, overrides);
		return problem
			? err(problem)
			: ok(new CoreConfigSelection(managed, unselected));
	}

	get entries(): readonly ConfigEntry[] {
		return this.managed.map((config) => config.entry);
	}

	get files(): ReadonlySet<string> {
		return this._files;
	}

	requireValid(): Result<ResolvedConfig[], DiagnosticsError> {
		const errors = this.entries.flatMap(errorsOf);
		return errors.length > 0
			? err(new DiagnosticsError(errors))
			: ok(this.entries.flatMap((entry) => buildableConfig(entry) ?? []));
	}

	get brokenError(): Error | undefined {
		const broken = this.entries.filter(
			(entry) => entry.status === "broken"
		);
		return broken.length > 0
			? new Error(
					`${broken.length} of ${this.entries.length} configs have errors.`
				)
			: undefined;
	}

	reload(files: readonly string[]): Promise<ConfigReload> {
		return this.reloads.queue(async () => {
			const changedFiles = new Set(files);
			const reloaded = await Promise.all(
				this.managed
					.filter((config) => config.reads(changedFiles))
					.map(async (config) => {
						const before = config.entry;
						const changed = await config.reload();
						const notice = noticeOf(before, config.entry);
						return { file: config.file, changed, notice };
					})
			);
			this._files = this.readFiles();
			return {
				changed: reloaded
					.filter(({ changed }) => changed)
					.map(({ file }) => file),
				notices: reloaded.flatMap(({ notice }) => notice ?? []),
			};
		});
	}

	private readFiles(): ReadonlySet<string> {
		return new Set(this.managed.flatMap((config) => config.files));
	}
}

/** What a user hasn't been told of a reload that took `before` to `after`. */
function noticeOf(
	before: ConfigEntry,
	after: ConfigEntry
): ConfigNotice | undefined {
	if (after.status === "valid")
		return before.status === "broken"
			? { kind: "recovered", file: after.file }
			: undefined;
	const errors = newDiagnostics(errorsOf(before), after.errors);
	return errors.length > 0
		? { kind: "broken", file: after.file, errors }
		: undefined;
}

/** A variant override that no config being built declares, as an error. */
function undeclaredVariant(
	managed: readonly ManagedConfig[],
	overrides: ConfigOverrides
): Error | undefined {
	const allReadable = managed.every(
		(config) => config.skippedVariants !== undefined
	);
	if (!allReadable) return undefined;
	for (const variant of Object.keys(overrides.variants)) {
		if (
			!managed.every((config) =>
				config.skippedVariants?.includes(variant)
			)
		)
			continue;
		const declared = managed.flatMap((config) =>
			Object.keys(buildableConfig(config.entry)?.variants ?? {})
		);
		const suggestion = closestMatch(variant, declared);
		return new Error(
			`Variant "${variant}" is not declared by any config being built. ` +
				(suggestion
					? `Did you mean "${suggestion}"?`
					: `Add it under "variants" in a config, or drop the flag.`)
		);
	}
	return undefined;
}
