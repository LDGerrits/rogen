import path from "path";
import { DeferredPromise, Sequencer } from "../../base/async.js";
import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { ConfigOptions } from "../config-options.js";
import { LogService } from "../../platform/log/log-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { FileChange } from "../../platform/fs/file-events.js";
import { ReconciliationService } from "../../platform/watcher/reconciliation-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { unrequestedConfigNotice } from "../../domain/config/config-discovery.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { requireValidConfigs } from "../../domain/config/valid-configs.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { renderDiagnostic } from "../../platform/diagnostics/render-diagnostic.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { BuildOutput, build, checkRoutes } from "../../domain/build/build.js";
import { ConfigEntry } from "../../domain/config/config-service.js";
import { checkSyncDir } from "../../domain/output/check-sync-dir.js";
import { findOutputClashes } from "../../domain/output/find-output-clashes.js";
import { writeOutput } from "../../domain/output/write-output.js";
import { dropSourceUpdates } from "../../domain/watch/drop-source-updates.js";
import { PrintedDiagnostics } from "../../domain/watch/printed-diagnostics.js";
import { createWatchPlan } from "../../domain/watch/watch-plan.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "watch",
	metadata: {
		requiresConfig: true,
		description:
			"Builds, then rebuilds whenever sources or configs change.",
		args: [
			{
				name: "name",
				description: "A config to watch.",
				isOptional: true,
				isVariadic: true,
			},
		],
		options: ConfigOptions,
	},
	handler: async (accessor) => {
		const logService = accessor.get(LogService);
		const watcher = accessor.get(Watcher);
		const reconciliationService = accessor.get(ReconciliationService);
		const configService = accessor.get(ConfigService);
		const lifecycleService = accessor.get(LifecycleService);
		const fileSystemService = accessor.get(FileSystemService);
		const environmentService = accessor.get(EnvironmentService);
		const indexService = accessor.get(IndexService);

		const configs = requireValidConfigs(configService);
		if (configs.isErr()) return configs;

		const notice = await unrequestedConfigNotice(
			fileSystemService,
			environmentService.cwd,
			configService.configs.map((entry) => entry.file)
		);
		if (notice) logService.info(notice);

		const liveEntries = () =>
			configService.configs.flatMap((entry) =>
				entry.resolved ? [{ file: entry.file, ...entry.resolved }] : []
			);
		const upfront = [
			...checkRoutes(liveEntries()),
			...findOutputClashes(liveEntries()),
		];
		if (upfront.length > 0) return err(new DiagnosticsError(upfront));

		const store = new DisposableStore();
		const shutdown = new DeferredPromise<void>();
		const intake = new Sequencer();
		const rebuilds = new Map<string, Sequencer>();
		const printed = new PrintedDiagnostics();
		const changedConfigs = new Set<string>();
		let plan = createWatchPlan(liveEntries());
		let activeWatch = "";

		const logDiagnostic = (diagnostic: Diagnostic): void => {
			const line = renderDiagnostic(diagnostic);
			if (diagnostic.severity === DiagnosticSeverity.Error) {
				logService.error(line);
			} else {
				logService.warn(line);
			}
		};

		const report = (
			file: string,
			stream: "build" | "sync",
			diagnostics: readonly Diagnostic[]
		): void => {
			for (const diagnostic of printed.unseen(
				`${file}#${stream}`,
				diagnostics
			)) {
				logDiagnostic(diagnostic);
			}
		};

		const reportConfig = (entry: ConfigEntry): void => {
			const unseen = printed.unseen(
				`${entry.file}#config`,
				entry.diagnostics
			);
			const errors = unseen.filter(
				(diagnostic) => diagnostic.severity === DiagnosticSeverity.Error
			);
			if (errors.length > 0) {
				logService.error(
					`${errors.map(renderDiagnostic).join("\n")}\nStill building from the last valid ${path.basename(entry.file)}.`
				);
			}
			for (const diagnostic of unseen) {
				if (diagnostic.severity === DiagnosticSeverity.Warning) {
					logDiagnostic(diagnostic);
				}
			}
		};

		const rebuild = async (file: string, load: boolean): Promise<void> => {
			const config = configService.configs.find(
				(entry) => entry.file === file
			)?.resolved;
			if (!config) return;

			const missingRoutes = checkRoutes([
				{ file, routes: config.routes },
			]);
			const built: Result<BuildOutput, Diagnostic[]> =
				missingRoutes.length > 0
					? err(missingRoutes)
					: build(config, indexService);
			if (built.isErr()) {
				report(file, "build", built.error);
				return;
			}

			const written = await writeOutput(
				fileSystemService,
				config,
				built.value.value
			);
			if (written.isErr()) {
				report(file, "build", written.error);
				return;
			}
			report(file, "build", [
				...built.value.warnings,
				...written.value.warnings,
			]);

			const outFile =
				path.relative(environmentService.cwd, config.outFile) || ".";
			if (written.value.value.written) {
				logService.info(`Wrote ${outFile}.`);
			} else if (load) {
				logService.info(`${outFile} is up to date.`);
			}
			if (load) {
				report(
					file,
					"sync",
					await checkSyncDir(fileSystemService, config)
				);
			}
		};

		const pending = new Set<Promise<void>>();

		const guarded =
			(task: () => Promise<void>) => async (): Promise<void> => {
				if (shutdown.isSettled) return;
				try {
					await task();
				} catch (error) {
					logService.error(ErrorUtils.fromUnknown(error).message);
				}
			};

		const track = (queued: Promise<void>): void => {
			pending.add(queued);
			void queued.finally(() => pending.delete(queued));
		};

		const queueRebuild = (file: string, load: boolean): void => {
			let sequencer = rebuilds.get(file);
			if (!sequencer) {
				sequencer = new Sequencer();
				rebuilds.set(file, sequencer);
			}
			track(sequencer.queue(guarded(() => rebuild(file, load))));
		};

		const enqueue = (task: () => Promise<void>): void => {
			track(intake.queue(guarded(task)));
		};

		const watchRequests = () => [
			...[...configService.files].map((file) => ({
				path: file,
				recursive: false,
			})),
			...plan.roots.map((dir) => ({ path: dir, recursive: true })),
		];

		const watchKey = () => JSON.stringify([watchRequests(), plan.ignored]);

		const watchPlan = async (): Promise<void> => {
			activeWatch = watchKey();
			await watcher.watch(watchRequests(), {
				ignored: [...plan.ignored],
			});
			await indexService.initialize(plan.roots);
		};

		const refreshPlan = async (reindex: boolean): Promise<boolean> => {
			plan = createWatchPlan(liveEntries());
			const rewatch = watchKey() !== activeWatch;
			if (rewatch) await watchPlan();
			else if (reindex) await indexService.initialize(plan.roots);
			return rewatch || reindex;
		};

		const reloadConfigs = async (
			files: readonly string[]
		): Promise<string[]> => {
			await configService.reload(files);
			configService.configs.forEach(reportConfig);
			const changed = [...changedConfigs];
			changedConfigs.clear();
			return changed;
		};

		const onChanges = async (changes: FileChange[]): Promise<void> => {
			const configFiles = changes
				.map((change) => change.path)
				.filter((file) => configService.files.has(file));

			let reloaded: string[] = [];
			let reindexed = false;
			if (configFiles.length > 0) {
				logService.info("Config change detected. Reloading...");
				reloaded = await reloadConfigs(configFiles);
				reindexed = await refreshPlan(false);
			}

			const sourceChanges = changes.filter((change) =>
				plan.watches(change.path)
			);
			if (sourceChanges.length > 0) {
				indexService.applyChanges(sourceChanges);
			}

			const affected = new Set([
				...reloaded,
				...(reindexed ? liveEntries().map(({ file }) => file) : []),
				...sourceChanges.flatMap((change) =>
					plan.configsFor(change.path)
				),
			]);
			for (const file of affected) {
				queueRebuild(file, reloaded.includes(file));
			}
		};

		const onBurst = async (): Promise<void> => {
			logService.info(
				"Burst threshold reached. Executing full rebuild..."
			);
			const reloaded = await reloadConfigs([...configService.files]);
			await refreshPlan(true);
			for (const { file } of liveEntries()) {
				queueRebuild(file, reloaded.includes(file));
			}
		};

		try {
			store.add(
				lifecycleService.onWillShutdown(() => shutdown.complete())
			);
			store.add(
				configService.onDidChangeConfig((event) =>
					changedConfigs.add(event.resource)
				)
			);
			store.add(
				watcher.onDidChangeFile((changes) => {
					const relevant = dropSourceUpdates(
						changes,
						configService.files
					);
					if (relevant.length > 0) {
						reconciliationService.queueEvents(relevant);
					}
				})
			);
			store.add(
				reconciliationService.onDidEmitChanges((changes) =>
					enqueue(() => onChanges(changes))
				)
			);
			store.add(
				reconciliationService.onDidRequestReconciliation(() =>
					enqueue(onBurst)
				)
			);

			logService.info("Starting watch mode...");
			configService.configs.forEach(reportConfig);

			// Build only once the watcher is live, so no change goes unseen.
			await watchPlan();
			for (const { file } of liveEntries()) queueRebuild(file, true);

			await shutdown.p;

			return ok(undefined);
		} catch (error) {
			return err(ErrorUtils.fromUnknown(error));
		} finally {
			shutdown.complete();
			store[Symbol.dispose]();
			await Promise.allSettled([...pending]);
			await watcher.stop();
		}
	},
});
