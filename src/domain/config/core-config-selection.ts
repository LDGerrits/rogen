import { Sequencer } from "../../base/async.js";
import { Result, err, ok } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import { Config } from "../../platform/config/config-models.js";
import {
	Diagnostic,
	newDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "./config.js";
import { ConfigLoader, ConfigOverrides } from "./config-loader.js";
import {
	ConfigEntry,
	ConfigNotice,
	ConfigReload,
	ConfigSelection,
	buildableConfig,
} from "./config-service.js";

const errorsOf = (entry: ConfigEntry): readonly Diagnostic[] =>
	entry.status === "broken" ? entry.errors : [];

/** One config file that loads and reloads itself, and keeps its last valid version while the file is broken. */
export class ManagedConfig {
	private _entry: ConfigEntry | undefined;
	private config: Config | undefined;
	private _files: readonly string[] = [];
	private _skippedVariants: readonly string[] | undefined;

	constructor(
		readonly file: string,
		private readonly loader: ConfigLoader,
		private readonly overrides: ConfigOverrides
	) {}

	/** The latest snapshot; `load` must have finished. */
	get entry(): ConfigEntry {
		if (!this._entry) throw new Error(`${this.file} has not been loaded.`);
		return this._entry;
	}

	/** Every file the config reads: its chain and its template. */
	get files(): readonly string[] {
		return this._files;
	}

	/** The CLI variants this config does not declare; `undefined` when its chain could not be read. */
	get skippedVariants(): readonly string[] | undefined {
		return this._skippedVariants;
	}

	reads(changed: ReadonlySet<string>): boolean {
		return this._files.some((file) => changed.has(file));
	}

	async load(): Promise<void> {
		const lastValid = this._entry && buildableConfig(this._entry);
		const loaded = await this.loader.load(this.file, this.overrides);
		const fields = { file: this.file, parents: loaded.chain.slice(1) };
		this._files = loaded.files;
		this._skippedVariants = loaded.skippedVariants;

		if (loaded.resolved.isOk()) {
			this.config = loaded.config;
			this._entry = {
				...fields,
				status: "valid",
				config: loaded.resolved.value,
			};
		} else {
			this._entry = {
				...fields,
				status: "broken",
				errors: loaded.resolved.error,
				lastValid,
			};
		}
	}

	/** Whether the reload changed the version that builds. A config that loads equal to it keeps it, so the version is its identity. */
	async reload(): Promise<boolean> {
		const before = {
			config: this.config,
			built: buildableConfig(this.entry),
		};
		await this.load();
		const built = buildableConfig(this.entry);
		if (!this.config || !built) return false;

		const template = before.built?.template;
		const same =
			before.config !== undefined &&
			before.config.equals(this.config) &&
			(template
				? template.equals(built.template)
				: built.template === undefined);
		if (!same) return true;
		if (this._entry?.status === "valid" && before.built)
			this._entry = { ...this._entry, config: before.built };
		return false;
	}
}

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
						const before = errorsOf(config.entry);
						const changed = await config.reload();
						const errors = newDiagnostics(
							before,
							errorsOf(config.entry)
						);
						return { file: config.file, changed, errors };
					})
			);
			this._files = this.readFiles();
			return {
				changed: reloaded
					.filter(({ changed }) => changed)
					.map(({ file }) => file),
				notices: reloaded
					.filter(({ errors }) => errors.length > 0)
					.map(({ file, errors }): ConfigNotice => ({
						file,
						errors,
					})),
			};
		});
	}

	private readFiles(): ReadonlySet<string> {
		return new Set(this.managed.flatMap((config) => config.files));
	}
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
