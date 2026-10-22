import { groupBy } from "../../base/collections.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	diagnosticsReaching,
	isError,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { ConfigSelection } from "../config/config-service.js";
import { SyncTool } from "../toolchain/toolchain.js";
import {
	BuildRun,
	BuildSet,
	CheckedBuild,
	FailedBuild,
	LoadedBuild,
	OutputFile,
	UnwrittenBuild,
	WrittenBuild,
} from "./build.js";
import {
	Asked,
	BuildService,
	ConfigLocations,
	Diagnosis,
	LocateQuery,
	Locations,
	outsideEveryConfig,
	skippedByEveryConfig,
	skippedOutside,
} from "./build-service.js";
import { BuiltConfig, ConfigBuilder } from "./config-builder.js";
import { ProjectFileStaleness } from "./check/project-file-staleness.js";
import { OutsideSourcePaths } from "./check/outside-source-paths.js";
import { LocateTargets } from "./locate/locate-targets.js";
import { Locator } from "./locate/locator.js";
import { OutputWriter } from "./output-writer.js";

interface WriteOptions {
	readonly rewrite?: boolean;
}

type Attempt = BuiltConfig | FailedBuild;

export class CoreBuildService implements BuildService {
	declare readonly _serviceBrand: undefined;

	private readonly writer: OutputWriter;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly indexService: IndexService,
		private readonly syncTools: readonly SyncTool[]
	) {
		this.writer = new OutputWriter(fileSystemService);
	}

	build(
		selection: ConfigSelection,
		options: { readonly independent?: boolean } = {}
	): Promise<BuildRun> {
		return this.buildAll(selection, true, options.independent);
	}

	check(selection: ConfigSelection): Promise<BuildRun> {
		return this.buildAll(selection, false);
	}

	async projectFileOf(
		project: ResolvedConfig
	): Promise<RojoProjectFile | undefined> {
		const listing = await this.indexService.list([...project.indexedPaths]);
		return new ConfigBuilder(
			this.fileSystemService,
			listing,
			this.syncTools
		).projectFileOf(project);
	}

	private async buildAll(
		selection: ConfigSelection,
		write: boolean,
		independent = false
	): Promise<BuildRun> {
		const { set, unloaded } = BuildSet.partition(selection);
		const listing = await this.indexService.list(set.indexedPaths);
		const built = await this.attempt(
			set.configs.map((config) => ({ config, syncWarnings: undefined })),
			listing
		);
		const settled = await this.settle(
			built,
			unloaded.map(({ file }) => file),
			write,
			{ independent }
		);
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
		previous?: LoadedBuild,
		rewrite = false
	): Promise<LoadedBuild> {
		const config = set.configOf(projectFile);
		if (!config) throw new Error(`${projectFile} is not in the set.`);
		const syncWarnings =
			previous?.config === config ? previous.syncWarnings : undefined;
		const attempts = await this.attempt(
			[{ config, syncWarnings }],
			listing
		);
		const [build] = await this.settle(attempts, [], true, { rewrite });
		return build;
	}

	async locate(
		selection: ConfigSelection,
		targets?: LocateQuery
	): Promise<Result<Locations, DiagnosticsError>> {
		const { set } = BuildSet.partition(selection);
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
		const { set } = BuildSet.partition(selection);
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

	private async settle(
		attempts: readonly Attempt[],
		unloaded: readonly string[],
		write: boolean,
		options: WriteOptions & { readonly independent?: boolean } = {}
	): Promise<LoadedBuild[]> {
		const built = attempts.filter(
			(attempt): attempt is BuiltConfig =>
				!(attempt instanceof FailedBuild)
		);
		const failed = [
			...unloaded,
			...attempts.flatMap((attempt) =>
				attempt instanceof FailedBuild ? [attempt.config.file] : []
			),
		];
		if (write && options.independent)
			return [
				...attempts.filter(
					(attempt): attempt is FailedBuild =>
						attempt instanceof FailedBuild
				),
				...(await this.writeInOrder(built, options)),
			];
		if (failed.length === 0 && write)
			return this.writeInOrder(built, options);
		return Promise.all(
			attempts.map(async (attempt) => {
				if (attempt instanceof FailedBuild) return attempt;
				if (write) return CoreBuildService.unwritten(attempt, failed);
				const checked = await this.withStaleness(attempt);
				return failed.length === 0
					? new CheckedBuild(
							checked.config,
							checked.findings,
							checked.summary,
							checked.readFiles
						)
					: CoreBuildService.unwritten(checked, failed);
			})
		);
	}

	private async withStaleness(attempt: BuiltConfig): Promise<BuiltConfig> {
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
		built: readonly BuiltConfig[],
		options: WriteOptions
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
			const written = config.isAdopted
				? ok(false)
				: await this.writer.write(
						new OutputFile(config.projectFile),
						projectFile,
						options
					);
			if (written.isErr()) failed = config.file;
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
