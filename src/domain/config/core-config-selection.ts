import { Sequencer } from "../../base/async.js";
import { dirnamePosix, toPosix } from "../../base/path.js";
import { UsageError } from "../../base/errors.js";
import { compareStrings } from "../../base/collections.js";
import { Result, err, ok } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	newDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig, isConfigFileName } from "./config.js";
import { ConfigLoader } from "./config-loader.js";
import { ConfigOverrides } from "./layered-config.js";
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

/** The folder a selection was picked from, and how to list the configs in it now. */
export interface PickedFolder {
	readonly directory: string;
	/** Absolute, sorted; none when the folder has no config or can't be read. */
	list(): Promise<readonly string[]>;
}

/** The configs one invocation picked, each loading and reloading itself. */
export class CoreConfigSelection implements ConfigSelection {
	private readonly reloads = new Sequencer();
	private _files: ReadonlySet<string>;

	private constructor(
		private managed: readonly ManagedConfig[],
		private readonly loader: ConfigLoader,
		private readonly overrides: ConfigOverrides,
		readonly home: string,
		private readonly folder: PickedFolder | undefined
	) {
		this._files = this.readFiles();
	}

	/** Loads `files` with `overrides`; fails when a variant or mode override is declared by none of them. */
	static async load(
		files: readonly string[],
		loader: ConfigLoader,
		overrides: ConfigOverrides,
		home: string,
		folder?: PickedFolder
	): Promise<Result<CoreConfigSelection, Error>> {
		const managed = files.map(
			(file) => new ManagedConfig(file, loader, overrides)
		);
		await Promise.all(managed.map((config) => config.load()));
		const problem =
			undeclaredVariant(managed, overrides) ??
			undeclaredMode(managed, overrides);
		return problem
			? err(problem)
			: ok(
					new CoreConfigSelection(
						managed,
						loader,
						overrides,
						home,
						folder
					)
				);
	}

	get entries(): readonly ConfigEntry[] {
		return this.managed.map((config) => config.entry);
	}

	get files(): ReadonlySet<string> {
		return this._files;
	}

	get directory(): string | undefined {
		return this.folder?.directory;
	}

	concerns(file: string): boolean {
		if (this._files.has(file)) return true;
		const posixFile = toPosix(file);
		return (
			this.folder !== undefined &&
			isConfigFileName(posixFile) &&
			dirnamePosix(posixFile) === toPosix(this.folder.directory)
		);
	}

	requireValid(): Result<ResolvedConfig[], DiagnosticsError> {
		const errors = this.entries.flatMap(errorsOf);
		return errors.length > 0
			? err(new DiagnosticsError(errors))
			: ok(this.entries.flatMap((entry) => buildableConfig(entry) ?? []));
	}

	reload(files: readonly string[]): Promise<ConfigReload> {
		return this.reloads.queue(async () => {
			const changedFiles = new Set(files);
			const membership = await this.followFolder();
			const reloaded = await Promise.all(
				this.managed
					.filter(
						(config) =>
							!membership.added.includes(config) &&
							config.reads(changedFiles)
					)
					.map(async (config) => {
						const before = config.entry;
						const changed = await config.reload();
						const notice = noticeOf(before, config.entry);
						return { file: config.file, changed, notice };
					})
			);
			this._files = this.readFiles();
			const added = membership.added.map((config) => ({
				file: config.file,
				changed: buildableConfig(config.entry) !== undefined,
				notice: addedNotice(config.entry),
			}));
			const everyChange = [...reloaded, ...added];
			return {
				changed: this.managed
					.map(({ file }) => file)
					.filter((file) =>
						everyChange.some(
							(change) => change.file === file && change.changed
						)
					),
				notices: [
					...membership.removed.map((file): ConfigNotice => ({
						kind: "removed",
						file,
					})),
					...everyChange.flatMap(({ notice }) => notice ?? []),
				],
			};
		});
	}

	/** Brings `managed` in line with the folder's configs now, loading the added ones. */
	private async followFolder(): Promise<{
		added: readonly ManagedConfig[];
		removed: readonly string[];
	}> {
		if (!this.folder) return { added: [], removed: [] };
		const now = new Set(await this.folder.list());
		const known = new Set(this.managed.map(({ file }) => file));
		const added = [...now]
			.filter((file) => !known.has(file))
			.map(
				(file) => new ManagedConfig(file, this.loader, this.overrides)
			);
		await Promise.all(added.map((config) => config.load()));
		const removed = [...known].filter((file) => !now.has(file));
		this.managed = [
			...this.managed.filter(({ file }) => now.has(file)),
			...added,
		].sort((a, b) => compareStrings(a.file, b.file));
		return { added, removed };
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
		? {
				kind: "broken",
				file: after.file,
				errors,
				keptLastValid: after.lastValid !== undefined,
			}
		: undefined;
}

/** What a user is told of a config that joined the selection. */
function addedNotice(entry: ConfigEntry): ConfigNotice {
	return entry.status === "valid"
		? { kind: "added", file: entry.file }
		: {
				kind: "broken",
				file: entry.file,
				errors: entry.errors,
				keptLastValid: false,
			};
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
		if (managed.some((config) => config.modes?.includes(variant))) {
			return new UsageError(
				`"${variant}" is a mode, not a variant. Pick it with --mode ${variant}.`
			);
		}
		const declared = managed.flatMap((config) =>
			Object.keys(buildableConfig(config.entry)?.variants ?? {})
		);
		const suggestion = closestMatch(variant, declared);
		return new UsageError(
			`Variant "${variant}" is not declared by any config being built. ` +
				(suggestion
					? `Did you mean "${suggestion}"?`
					: `Add it under "variants" in a config, or drop the flag.`)
		);
	}
	return undefined;
}

/** A mode override when no config being built declares any mode. A config that declares others but not this one reports it itself. */
function undeclaredMode(
	managed: readonly ManagedConfig[],
	overrides: ConfigOverrides
): Error | undefined {
	if (overrides.mode === undefined) return undefined;
	const allReadable = managed.every((config) => config.modes !== undefined);
	if (!allReadable || managed.some((config) => config.modes?.length))
		return undefined;
	return new UsageError(
		`Mode "${overrides.mode}" is not declared by any config being built. Add it under "modes" in a config, or drop the flag.`
	);
}
