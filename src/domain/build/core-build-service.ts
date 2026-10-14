import { groupBy } from "../../base/collections.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	diagnosticsPerFile,
	warningDiagnostic,
	diagnosticsReaching,
	isError,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigSelection } from "../config/config-service.js";
import { ProjectChoice } from "../config/project-choice.js";
import {
	BuildRun,
	BuildSet,
	FailedBuild,
	LoadedBuild,
	OutputFile,
	SyncTool,
	UnwrittenBuild,
	WrittenBuild,
} from "./build.js";
import {
	BuildService,
	ConfigLocations,
	Diagnosis,
	LocateQuery,
	Locations,
} from "./build-service.js";
import { BuiltConfig, ConfigBuilder } from "./config-builder.js";
import { Locator } from "./locator.js";
import { OutputWriter } from "./output-writer.js";

/** A config built in memory, or the reason it wasn't. */
type Attempt = BuiltConfig | FailedBuild;

export class CoreBuildService implements BuildService {
	declare readonly _serviceBrand: undefined;

	private readonly writer: OutputWriter;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly indexService: IndexService,
		/** What each tool that writes the sync path tells a build; the build names none of them. */
		private readonly syncTools: readonly SyncTool[]
	) {
		this.writer = new OutputWriter(fileSystemService);
	}

	build(selection: ConfigSelection): Promise<BuildRun> {
		return this.buildAll(selection, true);
	}

	/** Builds every selected config as `build` does, and writes nothing: the same builds with the same diagnostics, each config that built cleanly left as not written. */
	check(selection: ConfigSelection): Promise<BuildRun> {
		return this.buildAll(selection, false);
	}

	private async buildAll(
		selection: ConfigSelection,
		write: boolean
	): Promise<BuildRun> {
		const { set, unloaded } = BuildSet.partition(selection);
		const listing = await this.indexService.list(set.indexedPaths);
		const attempts = await this.attempt(
			set.configs.map((config) => ({ config, syncWarnings: undefined })),
			listing
		);
		const settled = await this.settle(
			attempts,
			unloaded.map(({ label }) => label),
			write
		);
		// Selection order, each config's builds beside the ones that didn't load.
		const builds = groupBy(
			[...unloaded, ...settled],
			(build) => build.file
		);
		return new BuildRun(
			selection.entries.flatMap((entry) => builds.get(entry.file) ?? [])
		);
	}

	async rebuild(
		set: BuildSet,
		projectFile: string,
		listing: IndexReader,
		previous?: LoadedBuild
	): Promise<LoadedBuild> {
		const config = set.configOf(projectFile);
		if (!config) throw new Error(`${projectFile} is not in the set.`);
		// The sync path changes only with the config or its compiler, so an answer for this version still holds.
		const syncWarnings =
			previous?.config === config ? previous.syncWarnings : undefined;
		const attempts = await this.attempt(
			[{ config, syncWarnings }],
			listing
		);
		const [build] = await this.settle(attempts, [], true);
		return build;
	}

	async locate(
		selection: ConfigSelection,
		targets?: LocateQuery
	): Promise<Result<Locations, DiagnosticsError>> {
		// What stops a config's build stops its answer too: it would describe a project that can't be built.
		const { set } = BuildSet.partition(selection);
		const errors = uniqueDiagnostics(
			selection.entries.flatMap((entry) =>
				entry.status === "broken" ? entry.errors : []
			)
		);

		const read = new BuildSet(
			ProjectChoice.read(set.configs, selection.named)
		);
		const listing = await this.indexService.list(read.indexedPaths);
		const located = await new Locator(
			this.fileSystemService,
			listing,
			this.syncTools
		).locate(read.configs, targets);
		if (located.isErr())
			return err(
				new DiagnosticsError([...errors, ...located.error.diagnostics])
			);
		return ok({ ...located.value, errors });
	}

	async diagnose(
		selection: ConfigSelection,
		targets?: LocateQuery
	): Promise<Result<Diagnosis, DiagnosticsError>> {
		if (!targets || targets.args.length === 0) {
			const { diagnostics } = await this.check(selection);
			return ok({
				diagnostics: diagnosticsPerFile(diagnostics),
				stoppedBy: [],
			});
		}
		const located = await this.locate(selection, targets);
		return located.map(({ errors, configs }) => {
			const about = (config: ConfigLocations) => [
				...config.files.map(({ source }) => source),
				...config.queried,
			];
			return {
				diagnostics: uniqueDiagnostics([
					...errors,
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

	/** Builds each config from `listing` in memory, in order. */
	private async attempt(
		configs: readonly {
			readonly config: ResolvedConfig;
			readonly syncWarnings: readonly Diagnostic[] | undefined;
		}[],
		listing: IndexReader
	): Promise<Attempt[]> {
		const builder = new ConfigBuilder(
			this.fileSystemService,
			listing,
			this.syncTools
		);
		const attempts: Attempt[] = [];
		for (const { config, syncWarnings } of configs) {
			const result = await builder.build(config, syncWarnings);
			attempts.push(
				result.isOk()
					? result.value
					: FailedBuild.before(
							config,
							result.error.diagnostics,
							syncWarnings
						)
			);
		}
		return attempts;
	}

	/** Writes the built configs in order unless one failed, `unloaded` names a config that didn't load, or `write` is off. */
	private async settle(
		attempts: readonly Attempt[],
		unloaded: readonly string[],
		write: boolean
	): Promise<LoadedBuild[]> {
		const built = attempts.filter(
			(attempt): attempt is BuiltConfig =>
				!(attempt instanceof FailedBuild)
		);
		const failed = [
			...unloaded,
			...attempts.flatMap((attempt) =>
				attempt instanceof FailedBuild ? [attempt.config.label] : []
			),
		];
		if (failed.length === 0 && write) return this.writeInOrder(built);
		return Promise.all(
			attempts.map(async (attempt) =>
				attempt instanceof FailedBuild
					? attempt
					: CoreBuildService.unwritten(
							write ? attempt : await this.withStaleness(attempt),
							failed
						)
			)
		);
	}

	/** The built config with a warning when the project file on disk isn't what a build would write. */
	private async withStaleness(attempt: BuiltConfig): Promise<BuiltConfig> {
		const { projectFile } = attempt.config;
		const onDisk = await tryWithAsync(async () =>
			(await this.fileSystemService.isFile(projectFile))
				? await this.fileSystemService.readFile(projectFile)
				: undefined
		);
		if (
			onDisk.isErr() ||
			onDisk.value === undefined ||
			onDisk.value === OutputWriter.textOf(attempt.projectFile)
		)
			return attempt;
		return {
			...attempt,
			findings: {
				...attempt.findings,
				warnings: [
					...attempt.findings.warnings,
					warningDiagnostic(
						"output.differs",
						{ resource: projectFile },
						`this file differs from what 'rogen build' would write. Run 'rogen build' to bring it up to date.`
					),
				],
			},
		};
	}

	/** Writes each config in turn; one that fails to write leaves the rest unwritten. */
	private async writeInOrder(
		built: readonly BuiltConfig[]
	): Promise<LoadedBuild[]> {
		const builds: LoadedBuild[] = [];
		let failed: string | undefined;
		for (const attempt of built) {
			const { config, projectFile, findings, summary, readFiles } =
				attempt;
			if (failed) {
				builds.push(CoreBuildService.unwritten(attempt, [failed]));
				continue;
			}
			const written = await this.writer.write(
				new OutputFile(config.projectFile),
				projectFile
			);
			if (written.isErr()) failed = config.label;
			builds.push(
				written.isErr()
					? new FailedBuild(
							config,
							written.error.diagnostics,
							findings
						)
					: new WrittenBuild(
							config,
							written.value ? "wrote" : "unchanged",
							findings,
							summary,
							readFiles
						)
			);
		}
		return builds;
	}

	private static unwritten(
		{ config, findings, summary, readFiles }: BuiltConfig,
		blockedBy: readonly string[]
	): UnwrittenBuild {
		return new UnwrittenBuild(
			config,
			findings,
			summary,
			readFiles,
			blockedBy
		);
	}
}
