import { groupBy } from "../../base/collections.js";
import { Result, err, ok } from "../../base/result.js";
import {
	isError,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileChange, FileChangeType } from "../../platform/fs/file-changes.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { ConfigSelection, ConfigService } from "../config/config-service.js";
import { SkippedPath } from "./write-service.js";
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
	AskedLocations,
	WriteService,
	WriteDraft,
	Diagnosis,
	LocateQuery,
	LocatedDiagnosis,
	Locations,
} from "./write-service.js";
import {
	AskedPaths,
	outsideEveryConfig,
	skippedByEveryConfig,
	skippedOutside,
} from "./asked-paths.js";
import {
	PreparedConfig,
	WritePipeline,
	diagnosticsOf,
} from "./write-pipeline.js";
import { placeholderState } from "./compiled-layout.js";
import { ProjectFileStaleness } from "./check/project-file-staleness.js";
import { OutsideSourcePaths } from "./check/outside-source-paths.js";
import { LocateTargets } from "./locate/locate-targets.js";
import { Locator } from "./locate/locator.js";
import { OutputWriter } from "./output-writer.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { ServiceCollection } from "../../platform/instantiation/service-collection.js";
import {
	DraftFileReader,
	FileDraft,
} from "../../platform/fs/draft-file-reader.js";

interface WriteOptions {
	readonly force?: boolean;
}

const ROGEN_ADVICE: ReadonlySet<string> = new Set(["scan.unmountedSource"]);

const RECHECK_WRITES_NOTHING: WrittenConfig["kind"] = "unchanged";

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
		@InstantiationService
		private readonly instantiationService: InstantiationService,
		@ConfigService private readonly configService: ConfigService
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

	check(selection: ConfigSelection): Promise<WriteRun> {
		return this.writeAll(selection, { write: false });
	}

	openDraft(draft: FileDraft): WriteDraft {
		const scope = this.instantiationService.createChild(
			new ServiceCollection([
				FileSystemService,
				this.instantiationService.createInstance(
					DraftFileReader,
					draft
				),
			]),
			{ rebuilt: [IndexService, ConfigService, WriteService] }
		);
		try {
			return scope.invokeFunction((accessor) => ({
				configService: accessor.get(ConfigService),
				writeService: accessor.get(WriteService),
				[Symbol.dispose]: () => scope[Symbol.dispose](),
			}));
		} catch (error) {
			scope[Symbol.dispose]();
			throw error;
		}
	}

	private async writeAll(
		selection: ConfigSelection,
		{
			write,
			independent = false,
			advice = false,
		}: {
			readonly write: boolean;
			readonly independent?: boolean;
			readonly advice?: boolean;
		}
	): Promise<WriteRun> {
		const { set, unloaded } = WriteSet.partition(selection);
		const listing = await this.indexService.list(set.indexedPaths);
		const attempts = await this.attempt(
			set.configs.map((config) => ({
				config,
				sync: SyncWarnings.unknown,
			})),
			listing,
			advice
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
			selection.entries.flatMap((entry) => outcomes.get(entry.file)!)
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
		const sync =
			previousSync.kind === "known"
				? previousSync
				: SyncWarnings.deferred;
		const attempts = await this.attempt([{ config, sync }], listing);
		const [outcome] = await this.settle(attempts, [], true, { force });
		return sync.kind === "known"
			? outcome
			: this.checkCompiledPathAfterWrite(config, outcome, listing);
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
		return sync.kind === "known"
			? CoreWriteService.withSyncWarnings(
					previous,
					sync,
					RECHECK_WRITES_NOTHING
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
		const located = await this.instantiationService
			.createInstance(Locator, listing, this.syncTools)
			.locate(set.configs, targets);
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

	async diagnose(query: LocateQuery): Promise<Result<Diagnosis, Error>> {
		if (query.args.length === 0) {
			const selection = await this.configService.select(
				await this.configService.configsHere()
			);
			if (selection.isErr()) return selection;
			return ok({
				...(await this.diagnoseWhole(selection.value)),
				named: [],
			});
		}
		const asking = await this.ask(query);
		if (asking.isErr()) return asking;
		const parts: Omit<Diagnosis, "named">[] = [];
		for (const { selection, indexes, whole } of asking.value.groups) {
			const found = whole
				? ok(await this.diagnoseWhole(selection))
				: await this.diagnosePaths(selection, {
						args: asking.value.argsAt(indexes),
						cwd: query.cwd,
					});
			if (found.isErr()) return found;
			parts.push(found.value);
		}
		const merged = asking.value.mergeDiagnoses(parts);
		return ok({ ...merged, named: await this.namedFor(merged.skipped) });
	}

	async locateAsked(
		query: LocateQuery
	): Promise<Result<AskedLocations, Error>> {
		if (query.args.length === 0) {
			const selection = await this.configService.select(
				await this.configService.configsHere()
			);
			if (selection.isErr()) return selection;
			const located = await this.locate(selection.value, query);
			return located.map((locations) => ({
				locations,
				skipped: [],
				named: [],
			}));
		}
		const asking = await this.ask(query);
		if (asking.isErr()) return asking;
		const parts: Locations[] = [];
		for (const { selection, indexes, whole } of asking.value.groups) {
			const located = await this.locate(selection, {
				args: whole ? [] : asking.value.argsAt(indexes),
				cwd: query.cwd,
			});
			if (located.isErr()) return located;
			parts.push(located.value);
		}
		const locations = asking.value.mergeLocations(parts);
		return ok({
			locations,
			skipped: locations.skipped,
			named: await this.namedFor(locations.skipped),
		});
	}

	private async ask({
		args: given,
		cwd,
	}: LocateQuery): Promise<Result<AskedPaths, Error>> {
		const resolved = await this.configService.resolveNames(given);
		if (resolved.isErr()) return resolved;
		const args = resolved.value;
		const { asked } = await this.instantiationService
			.createInstance(LocateTargets)
			.classify({ args, cwd });
		const covering = await this.configService.selectCovering(
			asked.map((one) => ("path" in one ? one.path : undefined))
		);
		if (covering.isErr()) return covering;
		const readers = new Map<number, readonly string[]>();
		for (const index of covering.value.uncovered)
			readers.set(
				index,
				await this.configService.readersOf(
					AskedPaths.pathAt(asked, index)
				)
			);
		return ok(new AskedPaths(args, asked, covering.value, readers));
	}

	private async namedFor(
		skipped: readonly SkippedPath[]
	): Promise<readonly string[]> {
		return skipped.some(({ reason }) => reason === "noConfig")
			? this.configService.namedConfigs()
			: [];
	}

	private async diagnoseWhole(
		selection: ConfigSelection
	): Promise<Omit<Diagnosis, "named">> {
		const { diagnostics } = await this.writeAll(selection, {
			write: false,
			advice: true,
		});
		return {
			diagnostics,
			stoppedBy: [],
			failing: diagnostics,
			skipped: [],
		};
	}

	private async diagnosePaths(
		selection: ConfigSelection,
		targets: LocateQuery
	): Promise<Result<Omit<Diagnosis, "named">, DiagnosticsError>> {
		const { set } = WriteSet.partition(selection);
		const errors = uniqueDiagnostics(
			selection.entries.flatMap((entry) =>
				entry.status === "broken" ? entry.errors : []
			)
		);
		const listing = await this.indexService.list(set.indexedPaths);
		const checked = await this.instantiationService
			.createInstance(Locator, listing, this.syncTools)
			.check(set.configs, targets);
		if (checked.isErr())
			return err(
				new DiagnosticsError([...errors, ...checked.error.diagnostics])
			);
		const configs = checked.value.map(({ locations }) => locations);
		const outside = new OutsideSourcePaths(
			configs.flatMap(({ config }) => config.sourcePaths)
		);
		const misspelt = outsideEveryConfig(configs).map((source) => ({
			source,
			warnings: outside.about(source),
		}));
		const shown = checked.value.map(({ locations, findings, own }) => {
			const reaching = new LocatedDiagnosis(locations).reaching;
			return [
				...reaching,
				...findings.filter(
					(diagnostic) =>
						own.has(diagnostic) && !reaching.includes(diagnostic)
				),
			];
		});
		const diagnostics = uniqueDiagnostics([
			...errors,
			...misspelt.flatMap(({ warnings }) => warnings),
			...shown.flat(),
		]);
		const stoppedBy = uniqueDiagnostics(
			checked.value.flatMap(({ findings }, at) =>
				findings.filter(
					(diagnostic) =>
						isError(diagnostic) && !shown[at].includes(diagnostic)
				)
			)
		);
		return ok({
			diagnostics,
			stoppedBy,
			failing: uniqueDiagnostics([...diagnostics, ...stoppedBy]),
			skipped: skippedOutside(
				misspelt
					.filter(({ warnings }) => warnings.length === 0)
					.map(({ source }) => source),
				configs
			),
		});
	}

	private async attempt(
		configs: readonly {
			readonly config: ResolvedConfig;
			readonly sync: SyncWarnings;
		}[],
		listing: IndexReader,
		advice = false
	): Promise<Attempt[]> {
		const pipeline = this.instantiationService.createInstance(
			WritePipeline,
			listing,
			this.syncTools
		);
		const attempts: Attempt[] = [];
		for (const { config, sync } of configs) {
			const run = await pipeline.run(config, sync);
			attempts.push(
				run.stoppedAt === "end"
					? advice
						? run.prepared
						: withoutRogenAdvice(run.prepared)
					: FailedConfig.before(config, diagnosticsOf(run), sync)
			);
		}
		return attempts;
	}

	private async settle(
		attempts: readonly Attempt[],
		unloaded: readonly string[],
		write: boolean,
		options: WriteOptions & { readonly independent?: boolean }
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
		const stale = await this.instantiationService
			.createInstance(ProjectFileStaleness)
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
		return this.instantiationService
			.createInstance(WritePipeline, listing, this.syncTools)
			.compiledPathWarnings(config);
	}

	private async checkCompiledPathAfterWrite(
		config: ResolvedConfig,
		outcome: LoadedConfig,
		listing: IndexReader
	): Promise<LoadedConfig> {
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
