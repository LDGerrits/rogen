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
import {
	configLabel,
	unrequestedConfigNotice,
} from "../../domain/config/config-discovery.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { requireValidConfigs } from "../../domain/config/valid-configs.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { BuildOutput, build, checkRoutes } from "../../domain/build/build.js";
import { ConfigEntry } from "../../domain/config/config-service.js";
import { checkSyncDir } from "../../domain/output/check-sync-dir.js";
import { findOutputClashes } from "../../domain/output/find-output-clashes.js";
import { writeOutput } from "../../domain/output/write-output.js";
import { dropSourceUpdates } from "../../domain/watch/drop-source-updates.js";
import {
	clockTime,
	describeChange,
} from "../../domain/watch/describe-change.js";
import { PrintedDiagnostics } from "../../domain/watch/printed-diagnostics.js";
import { createWatchPlan } from "../../domain/watch/watch-plan.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";

interface RebuildReport {
	readonly outFile: string;
	readonly outcome: "wrote" | "unchanged" | "failed";
	readonly diagnostics: readonly Diagnostic[];
}

interface ConfigNotice {
	readonly file: string;
	readonly errors: readonly Diagnostic[];
	readonly warnings: readonly Diagnostic[];
}

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

		const liveEntries = () =>
			configService.configs.flatMap((entry) =>
				entry.resolved ? [{ file: entry.file, ...entry.resolved }] : []
			);
		const upfront = [
			...checkRoutes(liveEntries()),
			...findOutputClashes(liveEntries()),
		];
		if (upfront.length > 0) return err(new DiagnosticsError(upfront));

		logService.intro(
			`rogen watch · ${liveEntries()
				.map(({ file }) => configLabel(file))
				.join(", ")}`
		);
		if (notice) logService.info(notice);

		const store = new DisposableStore();
		const shutdown = new DeferredPromise<void>();
		const intake = new Sequencer();
		const rebuilds = new Map<string, Sequencer>();
		const printer = new Sequencer();
		const notices: ConfigNotice[] = [];
		const printed = new PrintedDiagnostics();
		const changedConfigs = new Set<string>();
		let plan = createWatchPlan(liveEntries());
		let activeWatch = "";

		const unseen = (
			file: string,
			stream: "build" | "sync",
			diagnostics: readonly Diagnostic[]
		): readonly Diagnostic[] =>
			printed.unseen(`${file}#${stream}`, diagnostics);

		const reportConfig = (entry: ConfigEntry): void => {
			const fresh = printed.unseen(
				`${entry.file}#config`,
				entry.diagnostics
			);
			const isError = (diagnostic: Diagnostic) =>
				diagnostic.severity === DiagnosticSeverity.Error;
			const errors = fresh.filter(isError);
			const warnings = fresh.filter((diagnostic) => !isError(diagnostic));
			if (errors.length + warnings.length > 0)
				notices.push({ file: entry.file, errors, warnings });
		};

		const rebuild = async (
			file: string,
			load: boolean
		): Promise<RebuildReport | undefined> => {
			const config = configService.configs.find(
				(entry) => entry.file === file
			)?.resolved;
			if (!config) return undefined;

			const outFile =
				path.relative(environmentService.cwd, config.outFile) || ".";
			const finish = (
				outcome: RebuildReport["outcome"],
				diagnostics: readonly Diagnostic[]
			): RebuildReport => ({
				outFile,
				outcome,
				diagnostics,
			});

			const missingRoutes = checkRoutes([
				{ file, routes: config.routes },
			]);
			const built: Result<BuildOutput, Diagnostic[]> =
				missingRoutes.length > 0
					? err(missingRoutes)
					: build(config, indexService);
			if (built.isErr())
				return finish("failed", unseen(file, "build", built.error));

			const written = await writeOutput(
				fileSystemService,
				config,
				built.value.value
			);
			if (written.isErr())
				return finish("failed", unseen(file, "build", written.error));

			const diagnostics = [
				...unseen(file, "build", [
					...built.value.warnings,
					...written.value.warnings,
				]),
				...(load
					? unseen(
							file,
							"sync",
							await checkSyncDir(fileSystemService, config)
						)
					: []),
			];
			return finish(
				written.value.value.written ? "wrote" : "unchanged",
				diagnostics
			);
		};

		const printNotice = ({ file, errors, warnings }: ConfigNotice) => {
			for (const diagnostic of errors) logService.diagnostic(diagnostic);
			if (errors.length > 0) {
				logService.error(
					`Still building from the last valid ${path.basename(file)}.`
				);
			}
			for (const diagnostic of warnings)
				logService.diagnostic(diagnostic);
		};

		const printReport = ({
			outFile,
			outcome,
			diagnostics,
		}: RebuildReport) => {
			if (outcome === "failed") {
				logService.error(
					diagnostics.length > 0
						? `${outFile} · not written`
						: `${outFile} · not written · same errors as before`
				);
			} else {
				logService.success(`${outFile} · ${outcome}`);
			}
			for (const diagnostic of diagnostics)
				logService.diagnostic(diagnostic);
		};

		const pending = new Set<Promise<void>>();

		const reported =
			<T>(task: () => Promise<T>) =>
			async (): Promise<T | undefined> => {
				try {
					return await task();
				} catch (error) {
					logService.error(ErrorUtils.fromUnknown(error).message);
					return undefined;
				}
			};

		const guarded =
			<T>(task: () => Promise<T>) =>
			async (): Promise<T | undefined> =>
				shutdown.isSettled ? undefined : reported(task)();

		const track = (queued: Promise<unknown>): void => {
			const tracked = queued.then(
				() => undefined,
				() => undefined
			);
			pending.add(tracked);
			void tracked.finally(() => pending.delete(tracked));
		};

		const queueRebuild = (
			file: string,
			load: boolean
		): Promise<RebuildReport | undefined> => {
			let sequencer = rebuilds.get(file);
			if (!sequencer) {
				sequencer = new Sequencer();
				rebuilds.set(file, sequencer);
			}
			const queued = sequencer.queue(guarded(() => rebuild(file, load)));
			track(queued);
			return queued;
		};

		const announce = (
			title: string,
			results: readonly Promise<RebuildReport | undefined>[]
		): void => {
			const at = new Date();
			const raised = notices.splice(0);
			if (raised.length === 0 && results.length === 0) return;
			track(
				printer.queue(
					reported(async () => {
						const reports = (await Promise.all(results)).filter(
							(report) => report !== undefined
						);
						if (raised.length === 0 && reports.length === 0) return;
						logService.step(`${clockTime(at)} · ${title}`);
						raised.forEach(printNotice);
						reports.forEach(printReport);
					})
				)
			);
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

		// JSON.stringify drops a RegExp's source, so stringify patterns explicitly
		const watchKey = () =>
			JSON.stringify([watchRequests(), plan.ignored.map(String)]);

		const watchPlan = async (): Promise<void> => {
			activeWatch = watchKey();
			await watcher.watch(watchRequests(), {
				ignored: [...plan.ignored],
			});
			await indexService.initialize(plan.roots);
		};

		const refreshPlan = async (): Promise<boolean> => {
			plan = createWatchPlan(liveEntries());
			if (watchKey() === activeWatch) return false;
			await watchPlan();
			return true;
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

		const applyConfigChanges = async (
			files: readonly string[]
		): Promise<{ reloaded: string[]; reindexed: boolean }> => {
			const reloaded = new Set<string>();
			let reindexed = false;
			let toReload = files;
			for (;;) {
				for (const file of await reloadConfigs(toReload)) {
					reloaded.add(file);
				}
				if (!(await refreshPlan())) break;
				reindexed = true;
				// A config edited while the watcher restarted was never reported.
				toReload = [...configService.files];
			}
			return { reloaded: [...reloaded], reindexed };
		};

		const onChanges = async (changes: FileChange[]): Promise<void> => {
			const configFiles = changes
				.map((change) => change.path)
				.filter((file) => configService.files.has(file));

			let reloaded: string[] = [];
			let reindexed = false;
			if (configFiles.length > 0) {
				({ reloaded, reindexed } =
					await applyConfigChanges(configFiles));
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
			const results = [...affected].map((file) =>
				queueRebuild(file, reloaded.includes(file))
			);
			announce(
				describeChange({
					sourceFiles: sourceChanges.length,
					configFiles: configFiles.map((file) => path.basename(file)),
					reloaded: reloaded.length > 0,
				}),
				results
			);
		};

		const onBurst = async (): Promise<void> => {
			const { reloaded, reindexed } = await applyConfigChanges([
				...configService.files,
			]);
			if (!reindexed) await indexService.initialize(plan.roots);
			announce(
				"many changes · full rebuild",
				liveEntries().map(({ file }) =>
					queueRebuild(file, reloaded.includes(file))
				)
			);
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

			configService.configs.forEach(reportConfig);

			// Build only once the watcher is live, so no change goes unseen.
			await watchPlan();
			announce(
				"initial build",
				liveEntries().map(({ file }) => queueRebuild(file, true))
			);

			await shutdown.p;
			await Promise.allSettled([...pending]);
			logService.outro("Stopped watching.");

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
