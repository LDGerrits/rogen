import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { IndexReader, IndexService } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { ConfigSelection } from "../config/config-service.js";
import {
	BuildSet,
	ConfigBuild,
	FailedBuild,
	LoadedBuild,
	Locations,
	OutputFile,
	SyncTool,
	UnloadedBuild,
	UnwrittenBuild,
	WrittenBuild,
} from "./build.js";
import { BuildService, LocateTargets } from "./build-service.js";
import { BuiltConfig, ConfigBuilder } from "./config-builder.js";
import { Locator } from "./locator.js";
import { OutputWriter } from "./output-writer.js";

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

	async build(
		selection: ConfigSelection
	): Promise<Result<ConfigBuild[], DiagnosticsError>> {
		const unloaded = selection.entries.flatMap((entry) =>
			entry.status === "broken"
				? [new UnloadedBuild(entry.file, entry.errors)]
				: []
		);
		const set = new BuildSet(
			selection.entries.flatMap((entry) =>
				entry.status === "valid" ? [entry.config] : []
			)
		);
		if (set.diagnostics.length > 0)
			return err(
				new DiagnosticsError([
					...unloaded.flatMap(({ errors }) => errors),
					...set.diagnostics,
				])
			);
		const { configs } = set;
		const listing = await this.indexService.list(
			configs.flatMap(({ rootDirs }) => rootDirs)
		);
		const built = await this.run(
			configs.map((config) => ({ config, syncWarnings: undefined })),
			listing,
			unloaded.map(({ label }) => label)
		);
		// Selection order, each config's build beside the ones that didn't load.
		const loaded = [...built];
		return ok(
			selection.entries.map(
				(entry) =>
					unloaded.find(({ file }) => file === entry.file) ??
					loaded.shift()!
			)
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
		const blocked = set.blocking(file);
		if (blocked.length > 0)
			return new FailedBuild(config, blocked, {
				warnings: [],
				syncWarnings,
			});
		const [build] = await this.run([{ config, syncWarnings }], listing);
		return build;
	}

	async locate(
		selection: ConfigSelection,
		targets?: LocateTargets
	): Promise<Result<Locations, DiagnosticsError>> {
		const errors = selection.entries.flatMap((entry) =>
			entry.status === "broken" ? entry.errors : []
		);
		const configs = selection.entries.flatMap((entry) =>
			entry.status === "valid" ? [entry.config] : []
		);

		const listing = await this.indexService.list(
			configs.flatMap(({ rootDirs }) => rootDirs)
		);
		const located = await new Locator(
			this.fileSystemService,
			listing,
			this.syncTools
		).locate(configs, targets);
		if (located.isErr())
			return err(
				new DiagnosticsError([...errors, ...located.error.diagnostics])
			);
		return ok({ ...located.value, errors });
	}

	/** Builds every config from `listing`, then writes them in order unless one failed or `unloaded` names a config that didn't load. */
	private async run(
		configs: readonly {
			readonly config: ResolvedConfig;
			readonly syncWarnings: readonly Diagnostic[] | undefined;
		}[],
		listing: IndexReader,
		unloaded: readonly string[] = []
	): Promise<LoadedBuild[]> {
		const builder = this.builderOf(listing);
		const attempts: (BuiltConfig | FailedBuild)[] = [];
		for (const { config, syncWarnings } of configs) {
			const result = await builder.build(config, syncWarnings);
			attempts.push(
				result.isOk()
					? result.value
					: new FailedBuild(config, result.error.diagnostics, {
							warnings: [],
							syncWarnings,
						})
			);
		}
		const failed = [
			...unloaded,
			...attempts.flatMap((attempt) =>
				attempt instanceof FailedBuild ? [attempt.config.label] : []
			),
		];
		if (failed.length === 0)
			return this.writeInOrder(attempts as BuiltConfig[]);
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
					? new FailedBuild(config, written.error.diagnostics, findings)
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

	private builderOf(index: IndexReader): ConfigBuilder {
		return new ConfigBuilder(this.fileSystemService, index, this.syncTools);
	}
}
