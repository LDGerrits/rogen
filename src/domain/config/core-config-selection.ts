import path from "path";
import { Sequencer } from "../../base/async.js";
import { PathSet, dirnamePosix, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	newDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "./resolved-config.js";
import { isDefaultConfigFileName } from "./config.js";
import { ConfigLoader } from "./config-loader.js";
import { ManagedConfig } from "./managed-config.js";
import {
	ConfigEntry,
	ConfigNotice,
	ConfigReload,
	ReloadableSelection,
	validConfigs,
} from "./config-service.js";

const errorsOf = (entry: ConfigEntry): readonly Diagnostic[] =>
	entry.status === "broken" ? entry.errors : [];

interface PickedFolder {
	readonly directory: string;
	/** Absolute and sorted; empty when the folder has no config or can't be read. */
	list(): Promise<readonly string[]>;
}

/** The configs one invocation picked, each loading and reloading itself. */
export class CoreConfigSelection implements ReloadableSelection {
	private readonly reloads = new Sequencer();
	private _files: ReadonlySet<string>;
	private filePaths: PathSet;

	constructor(
		private managed: readonly ManagedConfig[],
		private readonly loader: ConfigLoader,
		readonly home: string,
		private readonly folder: PickedFolder | undefined,
		readonly notes: readonly string[] = []
	) {
		this._files = this.readFiles();
		this.filePaths = new PathSet(this._files);
	}

	get entries(): readonly ConfigEntry[] {
		return this.managed.map(({ entry }) => entry);
	}

	get files(): ReadonlySet<string> {
		return this._files;
	}

	get followedFolder(): string | undefined {
		return this.folder?.directory;
	}

	reads(file: string): boolean {
		return this.filePaths.has(file);
	}

	concerns(file: string): boolean {
		if (this.reads(file)) return true;
		const posixFile = toPosix(file);
		return (
			this.folder !== undefined &&
			isDefaultConfigFileName(path.posix.basename(posixFile)) &&
			new PathSet([this.folder.directory]).has(dirnamePosix(posixFile))
		);
	}

	get configs(): ResolvedConfig[] {
		return this.entries.flatMap(validConfigs);
	}

	requireValid(): Result<ResolvedConfig[], DiagnosticsError> {
		const errors = this.entries.flatMap(errorsOf);
		return errors.length > 0
			? err(new DiagnosticsError(errors))
			: ok([...this.configs]);
	}

	reload(files: readonly string[]): Promise<ConfigReload> {
		return this.reloads.queue(async () => {
			const changedFiles = new PathSet(files);
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
			this.filePaths = new PathSet(this._files);
			const added = membership.added.map((config) => ({
				file: config.file,
				changed: validConfigs(config.entry).length > 0,
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

	private async followFolder(): Promise<{
		added: readonly ManagedConfig[];
		removed: readonly string[];
	}> {
		if (!this.folder) return { added: [], removed: [] };
		const now = new Set(await this.folder.list());
		const known = new Set(this.managed.map(({ file }) => file));
		const added = await Promise.all(
			[...now]
				.filter((file) => !known.has(file))
				.map((file) => ManagedConfig.open(file, this.loader))
		);
		const removed = [...known].filter((file) => !now.has(file));
		this.managed = [
			...this.managed.filter(({ file }) => now.has(file)),
			...added,
		];
		return { added, removed };
	}

	private readFiles(): ReadonlySet<string> {
		return new Set(this.managed.flatMap((config) => config.files));
	}
}

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
