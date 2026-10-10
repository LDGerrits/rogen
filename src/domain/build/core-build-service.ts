import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	diagnosticsPerFile,
	diagnosticsReaching,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigSelection } from "../config/config-service.js";
import {
	BuildRun,
	BuildSet,
	ConfigBuild,
	FailedBuild,
	LoadedBuild,
	OutputFile,
	SyncTool,
	UnwrittenBuild,
	WrittenBuild,
} from "./build.js";
import {
	BuildService,
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
		/** What each tool that writes the sync dir tells a build; the build names none of them. */
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
		const listing = await this.indexService.list(set.rootDirs);
		const attempts = await this.attempt(
			set,
			set.configs.map((config) => ({ config, syncWarnings: undefined })),
			listing
		);
		const settled = await this.settle(
			attempts,
			unloaded.map(({ label }) => label),
			write
		);
		// Selection order, each config's build beside the ones that didn't load.
		const builds = new Map<string, ConfigBuild>(
			[...unloaded, ...settled].map((build) => [build.file, build])
		);
		return new BuildRun(
			selection.entries.flatMap((entry) => builds.get(entry.file) ?? [])
		);
	}

	async rebuild(
		set: BuildSet,
		file: string,
		listing: IndexReader,
		previous?: LoadedBuild
	): Promise<LoadedBuild> {
		const config = set.configOf(file);
		if (!config) throw new Error(`${file} is not in the set.`);
		// The sync dir changes only with the config or its compiler, so an answer for this version still holds.
		const syncWarnings =
			previous?.config === config ? previous.syncWarnings : undefined;
		const attempts = await this.attempt(
			set,
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
				entry.status === "broken"
					? entry.errors
					: set.blocking(entry.config.file)
			)
		);

		const listing = await this.indexService.list(set.rootDirs);
		const located = await new Locator(
			this.fileSystemService,
			listing,
			this.syncTools
		).locate(set.buildable, targets);
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
			const files = configs.flatMap((config) =>
				config.files.map((file) => ({ file, config }))
			);
			return {
				diagnostics: [
					...errors,
					...files.flatMap(({ file, config }) =>
						diagnosticsReaching(config.diagnostics, file.source)
					),
				],
				stoppedBy: files.flatMap(({ file }) =>
					file.status === "blocked" && !file.own ? [file.by] : []
				),
			};
		});
	}

	/** Builds each config from `listing` in memory, in order; one `set` blocks fails without building. */
	private async attempt(
		set: BuildSet,
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
			const blocked = set.blocking(config.file);
			if (blocked.length > 0) {
				attempts.push(
					FailedBuild.before(config, blocked, syncWarnings)
				);
				continue;
			}
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
		return attempts.map((attempt) =>
			attempt instanceof FailedBuild
				? attempt
				: CoreBuildService.unwritten(attempt, failed)
		);
	}

	/** Writes each config in turn; one that fails to write leaves the rest unwritten. */
	private async writeInOrder(
		built: readonly BuiltConfig[]
	): Promise<LoadedBuild[]> {
		const builds: LoadedBuild[] = [];
		let failed: string | undefined;
		for (const attempt of built) {
			const { config, tree, findings, summary, readFiles } = attempt;
			if (failed) {
				builds.push(CoreBuildService.unwritten(attempt, [failed]));
				continue;
			}
			const written = await this.writer.write(
				new OutputFile(config.outFile),
				tree
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
