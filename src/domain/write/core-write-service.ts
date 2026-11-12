import { groupBy } from "../../base/collections.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileChange, FileChangeType } from "../../platform/fs/file-changes.js";
import {
	FileReader,
	FileSystemService,
} from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { ConfigSelection, ConfigService } from "../config/config-service.js";
import { SyncTool } from "../toolchain/toolchain.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import {
	WriteRun,
	WriteSet,
	CheckedConfig,
	FailedConfig,
	LoadedConfig,
	OutputFile,
	SyncWarnings,
	UnwrittenConfig,
	WrittenConfig,
	isFailed,
} from "./write.js";
import {
	Asked,
	WriteService,
	Diagnosis,
	LocateQuery,
	LocatedDiagnosis,
	Locations,
	outsideEveryConfig,
	skippedByEveryConfig,
	skippedOutside,
} from "./write-service.js";
import { PreparedConfig, WritePipeline } from "./write-pipeline.js";
import { placeholderState } from "./compiled-layout.js";
import { ProjectFileStaleness } from "./check/project-file-staleness.js";
import { OutsideSourcePaths } from "./check/outside-source-paths.js";
import { LocateTargets } from "./locate/locate-targets.js";
import { Locator } from "./locate/locator.js";
import { OutputWriter } from "./output-writer.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";

interface WriteOptions {
	readonly force?: boolean;
}

/** Warnings about Rogen's own model, which a plain Rojo project hears only from a diagnosis, as Rojo says nothing of them. */
const ROGEN_ADVICE: ReadonlySet<string> = new Set(["scan.unmountedSource"]);

/** `prepared` without Rogen's advice when its config is a plain Rojo project. */
function withoutRogenAdvice(prepared: PreparedConfig): PreparedConfig {
	if (!prepared.config.isAdopted) return prepared;
	return {
		...prepared,
		findings: {
			...prepared.findings,
			warnings: prepared.findings.warnings.filter(
				({ code }) => !ROGEN_ADVICE.has(code)
			),
		},
	};
}

type Attempt = PreparedConfig | FailedConfig;

export class CoreWriteService implements WriteService {
	declare readonly _serviceBrand: undefined;

	private readonly writer: OutputWriter;
	private readonly syncTools: readonly SyncTool[];

	constructor(
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@IndexService private readonly indexService: IndexService,
		@ToolchainService toolchainService: ToolchainService,
		@ConfigService private readonly configService: ConfigService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {
		this.syncTools = toolchainService.syncTools;
		this.writer = instantiationService.createInstance(OutputWriter);
	}

	write(
		selection: ConfigSelection,
		options: { readonly independent?: boolean } = {}
	): Promise<WriteRun> {
		return this.writeAll(selection, {
			write: true,
			independent: options.independent,
		});
	}

	check(selection: ConfigSelection, reader?: FileReader): Promise<WriteRun> {
		return this.writeAll(selection, { write: false, reader });
	}

	async projectFileOf(
		project: ResolvedConfig
	): Promise<RojoProjectFile | undefined> {
		const listing = await this.indexService.list([...project.indexedPaths]);
		return new WritePipeline(
			this.fileSystemService,
			listing,
			this.syncTools
		).projectFileOf(project);
	}

	/** With `advice`, a plain Rojo project keeps the warnings about Rogen's own model; with `reader`, a check reads through it. */
	private async writeAll(
		selection: ConfigSelection,
		{
			write,
			independent = false,
			advice = false,
			reader = this.fileSystemService,
		}: {
			readonly write: boolean;
			readonly independent?: boolean;
			readonly advice?: boolean;
			readonly reader?: FileReader;
		}
	): Promise<WriteRun> {
		const { set, unloaded } = WriteSet.partition(selection);
		const listing = await this.indexService.list(set.indexedPaths, reader);
		const attempts = await this.attempt(
			set.configs.map((config) => ({
				config,
				sync: SyncWarnings.unknown,
			})),
			listing,
			advice,
			reader
		);
		const settled = await this.settle(
			attempts,
			unloaded.map(({ file }) => file),
			write,
			{ independent, reader }
		);
		const outcomes = groupBy(
			[...unloaded, ...settled],
			(outcome) => outcome.file
		);
		return new WriteRun(
			selection.entries.flatMap((entry) => outcomes.get(entry.file) ?? [])
		);
	}

	async rewrite(
		set: WriteSet,
		projectFile: string,
		listing: IndexReader,
		previous?: LoadedConfig,
		force = false
	): Promise<LoadedConfig> {
		const config = set.configOf(projectFile);
		if (!config) throw new Error(`${projectFile} is not in the set.`);
		const previousSync =
			previous && CoreWriteService.sameVersion(previous, config)
				? previous.sync
				: SyncWarnings.unknown;
		// Unless known, checked after the write, which creates the compiled path's placeholders.
		const sync =
			previousSync.kind === "known"
				? previousSync
				: SyncWarnings.deferred;
		const attempts = await this.attempt([{ config, sync }], listing);
		const [outcome] = await this.settle(attempts, [], true, { force });
		if (sync.kind === "known") return outcome;
		if (isFailed(outcome))
			return new FailedConfig(config, outcome.errors, {
				warnings: outcome.warnings,
				sync: SyncWarnings.unknown,
			});
		return CoreWriteService.withSyncWarnings(
			outcome,
			await this.compiledPathWarnings(config, listing)
		);
	}

	async recheck(
		set: WriteSet,
		projectFile: string,
		listing: IndexReader,
		previous: LoadedConfig,
		changes: readonly FileChange[]
	): Promise<LoadedConfig> {
		const config = set.configOf(projectFile);
		if (
			!CoreWriteService.sameVersion(previous, config) ||
			isFailed(previous) ||
			(await this.onlyPlaceholders(changes))
		)
			return previous;
		const sync = await this.compiledPathWarnings(config, listing);
		// A recheck writes nothing, so a config it wrote before is unchanged now.
		return sync.kind === "known"
			? CoreWriteService.withSyncWarnings(previous, sync, "unchanged")
			: previous;
	}

	async locate(
		selection: ConfigSelection,
		targets?: LocateQuery
	): Promise<Result<Locations, DiagnosticsError>> {
		const { set } = WriteSet.partition(selection);
		const errors = uniqueDiagnostics(
			selection.entries.flatMap((entry) =>
				entry.status === "broken" ? entry.errors : []
			)
		);

		const listing = await this.indexService.list(set.indexedPaths);
		const located = await new Locator(
			this.fileSystemService,
			listing,
			this.syncTools
		).locate(set.configs, targets);
		if (located.isErr())
			return err(
				new DiagnosticsError([...errors, ...located.error.diagnostics])
			);
		return ok({
			...located.value,
			errors,
			skipped: skippedByEveryConfig(located.value.configs),
		});
	}

	askedAbout(query: LocateQuery): Promise<readonly Asked[]> {
		return new LocateTargets(this.fileSystemService)
			.classify(query)
			.then(({ asked }) => asked);
	}

	async staleProjectFiles(selection: ConfigSelection): Promise<Diagnostic[]> {
		const { set } = WriteSet.partition(selection);
		const written = await Promise.all(
			set.configs.map(({ projectFile }) =>
				this.fileSystemService.isFile(projectFile)
			)
		);
		if (!written.includes(true)) return [];
		const { diagnostics } = await this.check(selection);
		return diagnostics.filter(({ code }) => code === "output.differs");
	}

	async diagnose(
		selection: ConfigSelection,
		targets?: LocateQuery
	): Promise<Result<Diagnosis, DiagnosticsError>> {
		if (!targets || targets.args.length === 0) {
			const { diagnostics } = await this.writeAll(selection, {
				write: false,
				advice: true,
			});
			return ok({ diagnostics, stoppedBy: [], skipped: [] });
		}
		const located = await this.locate(selection, targets);
		return located.map(({ errors, configs }) => {
			const outside = new OutsideSourcePaths(
				configs.flatMap(({ config }) => config.sourcePaths)
			);
			const misspelt = outsideEveryConfig(configs).map((source) => ({
				source,
				warnings: outside.about(source),
			}));
			const diagnoses = configs.map(
				(config) => new LocatedDiagnosis(config)
			);
			return {
				skipped: skippedOutside(
					misspelt
						.filter(({ warnings }) => warnings.length === 0)
						.map(({ source }) => source),
					configs
				),
				diagnostics: uniqueDiagnostics([
					...errors,
					...misspelt.flatMap(({ warnings }) => warnings),
					...diagnoses.flatMap(({ reaching }) => reaching),
				]),
				stoppedBy: uniqueDiagnostics(
					diagnoses.flatMap(({ stoppedBy }) => stoppedBy)
				),
			};
		});
	}

	private async attempt(
		configs: readonly {
			readonly config: ResolvedConfig;
			readonly sync: SyncWarnings;
		}[],
		listing: IndexReader,
		advice = false,
		reader: FileReader = this.fileSystemService
	): Promise<Attempt[]> {
		const pipeline = new WritePipeline(reader, listing, this.syncTools);
		const attempts: Attempt[] = [];
		for (const { config, sync } of configs) {
			const result = await pipeline.run(config, sync);
			attempts.push(
				result.isOk()
					? advice
						? result.value
						: withoutRogenAdvice(result.value)
					: FailedConfig.before(
							config,
							result.error.diagnostics,
							sync
						)
			);
		}
		return attempts;
	}

	private async settle(
		attempts: readonly Attempt[],
		unloaded: readonly string[],
		write: boolean,
		options: WriteOptions & {
			readonly independent?: boolean;
			readonly reader?: FileReader;
		} = {}
	): Promise<LoadedConfig[]> {
		const prepared = attempts.filter(
			(attempt): attempt is PreparedConfig => !isFailed(attempt)
		);
		const failed = [
			...unloaded,
			...attempts.filter(isFailed).map(({ config }) => config.file),
		];
		if (write && (options.independent || failed.length === 0))
			return [
				...attempts.filter(isFailed),
				...(await this.writeInOrder(prepared, {
					force: options.force,
					stopOnFailure: !options.independent,
				})),
			];
		return Promise.all(
			attempts.map(async (attempt) => {
				if (isFailed(attempt)) return attempt;
				if (write) return CoreWriteService.unwritten(attempt, failed);
				const checked = await this.withStaleness(
					attempt,
					options.reader
				);
				return failed.length === 0
					? new CheckedConfig(
							checked.config,
							checked.findings,
							checked.summary,
							checked.readFiles
						)
					: CoreWriteService.unwritten(checked, failed);
			})
		);
	}

	private async withStaleness(
		attempt: PreparedConfig,
		reader: FileReader = this.fileSystemService
	): Promise<PreparedConfig> {
		const stale = await this.instantiationService
			.createInstance(ProjectFileStaleness, reader)
			.diagnostic(attempt.config, async () => attempt.projectFile);
		if (!stale) return attempt;
		return {
			...attempt,
			findings: {
				...attempt.findings,
				warnings: [...attempt.findings.warnings, stale],
			},
		};
	}

	private async writeInOrder(
		prepared: readonly PreparedConfig[],
		{
			force,
			stopOnFailure,
		}: WriteOptions & { readonly stopOnFailure: boolean }
	): Promise<LoadedConfig[]> {
		const outcomes: LoadedConfig[] = [];
		let failed: string | undefined;
		for (const attempt of prepared) {
			const { config, projectFile, findings, summary, readFiles } =
				attempt;
			if (failed) {
				outcomes.push(CoreWriteService.unwritten(attempt, [failed]));
				continue;
			}
			const written = config.isAdopted
				? ok(false)
				: await this.writer.write(
						new OutputFile(config.projectFile),
						projectFile,
						{ force, placeholders: attempt.placeholders }
					);
			if (written.isErr() && stopOnFailure) failed = config.file;
			outcomes.push(
				written.isErr()
					? new FailedConfig(
							config,
							written.error.diagnostics,
							findings
						)
					: new WrittenConfig(
							config,
							written.value ? "wrote" : "unchanged",
							findings,
							summary,
							readFiles
						)
			);
		}
		return outcomes;
	}

	private compiledPathWarnings(
		config: ResolvedConfig,
		listing: IndexReader
	): Promise<SyncWarnings> {
		return new WritePipeline(
			this.fileSystemService,
			listing,
			this.syncTools
		).compiledPathWarnings(config);
	}

	/** Whether each of `changes` adds what a write makes in the compiled path before the compiler runs: a folder, or a placeholder script. */
	private async onlyPlaceholders(
		changes: readonly FileChange[]
	): Promise<boolean> {
		for (const { type, path: file } of changes) {
			if (type !== FileChangeType.ADDED) return false;
			const state = await placeholderState(this.fileSystemService, file);
			if (state !== "folder" && state !== "placeholder") return false;
		}
		return true;
	}

	/** Whether `outcome` is of `config` as it is now; a config is immutable, so its object is its version. */
	private static sameVersion(
		outcome: LoadedConfig,
		config: ResolvedConfig | undefined
	): config is ResolvedConfig {
		return outcome.config === config;
	}

	private static withSyncWarnings(
		outcome: Exclude<LoadedConfig, FailedConfig>,
		sync: SyncWarnings,
		kind?: WrittenConfig["kind"]
	): LoadedConfig {
		const { config, summary, readFiles } = outcome;
		const findings = { warnings: outcome.warnings, sync };
		switch (outcome.kind) {
			case "notWritten":
				return new UnwrittenConfig(
					config,
					findings,
					summary,
					readFiles,
					outcome.blockedBy
				);
			case "wouldWrite":
				return new CheckedConfig(config, findings, summary, readFiles);
			default:
				return new WrittenConfig(
					config,
					kind ?? outcome.kind,
					findings,
					summary,
					readFiles
				);
		}
	}

	private static unwritten(
		{ config, findings, summary, readFiles }: PreparedConfig,
		blockedBy: readonly string[]
	): UnwrittenConfig {
		return new UnwrittenConfig(
			config,
			findings,
			summary,
			readFiles,
			blockedBy
		);
	}
}
