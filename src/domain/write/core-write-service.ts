import { groupBy } from "../../base/collections.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	diagnosticsReaching,
	isError,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileChange, FileChangeType } from "../../platform/fs/file-changes.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { ConfigSelection } from "../config/config-service.js";
import { SyncTool } from "../toolchain/toolchain.js";
import {
	WriteRun,
	WriteSet,
	CheckedConfig,
	FailedConfig,
	LoadedConfig,
	OutputFile,
	UnwrittenConfig,
	WrittenConfig,
} from "./write.js";
import {
	Asked,
	WriteService,
	ConfigLocations,
	Diagnosis,
	LocateQuery,
	Locations,
	outsideEveryConfig,
	skippedByEveryConfig,
	skippedOutside,
} from "./write-service.js";
import { PreparedConfig, WritePipeline } from "./write-pipeline.js";
import { PLACEHOLDER_SOURCE } from "./compiled-layout.js";
import { ProjectFileStaleness } from "./check/project-file-staleness.js";
import { OutsideSourcePaths } from "./check/outside-source-paths.js";
import { LocateTargets } from "./locate/locate-targets.js";
import { Locator } from "./locate/locator.js";
import { OutputWriter } from "./output-writer.js";

interface WriteOptions {
	readonly force?: boolean;
}

type Attempt = PreparedConfig | FailedConfig;

export class CoreWriteService implements WriteService {
	declare readonly _serviceBrand: undefined;

	private readonly writer: OutputWriter;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly indexService: IndexService,
		private readonly syncTools: readonly SyncTool[]
	) {
		this.writer = new OutputWriter(fileSystemService);
	}

	write(
		selection: ConfigSelection,
		options: { readonly independent?: boolean } = {}
	): Promise<WriteRun> {
		return this.writeAll(selection, true, options.independent);
	}

	check(selection: ConfigSelection): Promise<WriteRun> {
		return this.writeAll(selection, false);
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

	private async writeAll(
		selection: ConfigSelection,
		write: boolean,
		independent = false
	): Promise<WriteRun> {
		const { set, unloaded } = WriteSet.partition(selection);
		const listing = await this.indexService.list(set.indexedPaths);
		const attempts = await this.attempt(
			set.configs.map((config) => ({ config, syncWarnings: undefined })),
			listing
		);
		const settled = await this.settle(
			attempts,
			unloaded.map(({ file }) => file),
			write,
			{ independent }
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
		const known =
			previous?.config === config ? previous.syncWarnings : undefined;
		const attempts = await this.attempt(
			[{ config, syncWarnings: known ?? [] }],
			listing
		);
		const [outcome] = await this.settle(attempts, [], true, { force });
		if (known) return outcome;
		// Checked after the write, which creates the compiled path's placeholders.
		if (outcome.kind === "failed")
			return new FailedConfig(config, outcome.errors, {
				warnings: outcome.warnings,
				syncWarnings: undefined,
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
			previous.config !== config ||
			previous.kind === "failed" ||
			(await this.onlyPlaceholders(changes))
		)
			return previous;
		const syncWarnings = await this.compiledPathWarnings(config, listing);
		// A recheck writes nothing, so a config it wrote before is unchanged now.
		return syncWarnings
			? CoreWriteService.withSyncWarnings(
					previous,
					syncWarnings,
					"unchanged"
				)
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
			const { diagnostics } = await this.check(selection);
			return ok({ diagnostics, stoppedBy: [], skipped: [] });
		}
		const located = await this.locate(selection, targets);
		return located.map(({ errors, configs }) => {
			const about = (config: ConfigLocations) => [
				...config.files.map(({ source }) => source),
				...config.queried,
			];
			const outside = new OutsideSourcePaths(
				configs.flatMap(({ config }) => config.sourcePaths)
			);
			const misspelt = outsideEveryConfig(configs).map((source) => ({
				source,
				warnings: outside.about(source),
			}));
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
					...configs.flatMap((config) =>
						about(config).flatMap((target) =>
							diagnosticsReaching(config.diagnostics, target)
						)
					),
				]),
				stoppedBy: uniqueDiagnostics(
					configs.flatMap((config) =>
						config.diagnostics.filter(
							(diagnostic) =>
								isError(diagnostic) &&
								about(config).every(
									(target) =>
										diagnosticsReaching(
											[diagnostic],
											target
										).length === 0
								)
						)
					)
				),
			};
		});
	}

	private async attempt(
		configs: readonly {
			readonly config: ResolvedConfig;
			readonly syncWarnings: readonly Diagnostic[] | undefined;
		}[],
		listing: IndexReader
	): Promise<Attempt[]> {
		const pipeline = new WritePipeline(
			this.fileSystemService,
			listing,
			this.syncTools
		);
		const attempts: Attempt[] = [];
		for (const { config, syncWarnings } of configs) {
			const result = await pipeline.run(config, syncWarnings);
			attempts.push(
				result.isOk()
					? result.value
					: FailedConfig.before(
							config,
							result.error.diagnostics,
							syncWarnings
						)
			);
		}
		return attempts;
	}

	private async settle(
		attempts: readonly Attempt[],
		unloaded: readonly string[],
		write: boolean,
		options: WriteOptions & { readonly independent?: boolean } = {}
	): Promise<LoadedConfig[]> {
		const prepared = attempts.filter(
			(attempt): attempt is PreparedConfig =>
				!(attempt instanceof FailedConfig)
		);
		const failed = [
			...unloaded,
			...attempts.flatMap((attempt) =>
				attempt instanceof FailedConfig ? [attempt.config.file] : []
			),
		];
		if (write && options.independent)
			return [
				...attempts.filter(
					(attempt): attempt is FailedConfig =>
						attempt instanceof FailedConfig
				),
				...(await this.writeInOrder(prepared, options)),
			];
		if (failed.length === 0 && write)
			return this.writeInOrder(prepared, options);
		return Promise.all(
			attempts.map(async (attempt) => {
				if (attempt instanceof FailedConfig) return attempt;
				if (write) return CoreWriteService.unwritten(attempt, failed);
				const checked = await this.withStaleness(attempt);
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
		attempt: PreparedConfig
	): Promise<PreparedConfig> {
		const stale = await new ProjectFileStaleness(
			this.fileSystemService
		).diagnostic(attempt.config, async () => attempt.projectFile);
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
		options: WriteOptions
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
						{ ...options, placeholders: attempt.placeholders }
					);
			if (written.isErr()) failed = config.file;
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
	): Promise<Diagnostic[] | undefined> {
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
			if (await this.fileSystemService.isDirectory(file)) continue;
			if (
				!(await this.fileSystemService.isFile(file)) ||
				(await this.fileSystemService.readFile(file)) !==
					PLACEHOLDER_SOURCE
			)
				return false;
		}
		return true;
	}

	private static withSyncWarnings(
		outcome: Exclude<LoadedConfig, FailedConfig>,
		syncWarnings: readonly Diagnostic[] | undefined,
		kind?: WrittenConfig["kind"]
	): LoadedConfig {
		const { config, summary, readFiles } = outcome;
		const findings = { warnings: outcome.warnings, syncWarnings };
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
