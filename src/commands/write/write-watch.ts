import { DeferredPromise, Sequencer, aborted } from "../../base/async.js";
import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { isWritten } from "../../domain/write/write.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	RojoCommandService,
	RojoWatch,
} from "../../domain/runner/rojo-command-service.js";
import { WatchService } from "../../domain/watch/watch-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ReportedError } from "../../platform/commands/commands.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { RojoPlan, RojoStep } from "./rojo-step.js";
import {
	PrintedWatchLog,
	WatchJsonLog,
	WatchLog,
	WatchReporter,
} from "./watch-log.js";

/** The configs a watch writes: those the refs name (the folder's default when none), or `here`, every config of the working directory, following the ones that come and go. */
export type WatchedConfigs = readonly string[] | "here";

/** `rogen build --watch`, `rogen write --watch` and `rogen sourcemap --watch`: writes, then rewrites whenever names, folders or configs change, and runs Rojo's own watch from the first write when asked to. */
export class WriteWatch {
	constructor(
		private readonly configs: WatchedConfigs,
		private readonly json: boolean,
		/** What to run Rojo's watch for, when the files are not all that is wanted. */
		private readonly step: RojoStep | undefined,
		/** The command the header names when no Rojo step does. */
		private readonly command: string,
		@LogService private readonly logService: LogService,
		@ConfigService private readonly configService: ConfigService,
		@WatchService private readonly watchService: WatchService,
		@RojoCommandService
		private readonly rojoCommandService: RojoCommandService,
		@EnvironmentService
		private readonly environmentService: EnvironmentService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {}

	/** Runs until `shutdown` aborts; `store` is the caller's, and holds what the run subscribes to. */
	async run(
		store: DisposableStore,
		shutdown: AbortSignal
	): Promise<Result<void, Error>> {
		const {
			logService,
			configService,
			watchService,
			rojoCommandService,
			instantiationService,
		} = this;
		const { cwd } = this.environmentService;
		const stopped = new AbortController();
		store.add({ [Symbol.dispose]: () => stopped.abort() });
		const selection =
			this.configs === "here"
				? ok(await configService.selectHere())
				: await configService.select(this.configs);
		if (selection.isErr()) return selection;
		for (const note of selection.value.notes) logService.warn(note);
		if (this.step !== undefined) {
			const stepPlan = this.step.plan(selection.value);
			if (stepPlan.isErr()) return stepPlan;
		}
		const printing = this.step?.prints ?? false;
		if (printing && !this.json) logService.reserveStdout();
		const log: WatchReporter = this.json
			? instantiationService.createInstance(WatchJsonLog, cwd)
			: printing
				? instantiationService.createInstance(
						PrintedWatchLog,
						cwd,
						"watch"
					)
				: instantiationService.createInstance(
						WatchLog,
						cwd,
						`${this.step?.command ?? this.command} --watch`
					);
		const watched = watchService.watch(selection.value);
		if (watched.isErr()) return watched;
		const session = store.add(watched.value);
		if (shutdown.aborted) return ok(undefined);
		log.begin(session.configs, selection.value.home);

		const rojoStarts = new Sequencer();
		const failed = new DeferredPromise<Error>();
		let rojo: RojoWatch | undefined;
		let rojoProject: string | undefined;
		const rojoListeners = store.add(new DisposableStore());
		const startRojo = (step: RojoStep, plan: RojoPlan) =>
			rojoStarts.queue(async () => {
				const previous = rojo;
				rojo = undefined;
				rojoListeners.clear();
				if (previous) {
					await previous.terminate();
					previous[Symbol.dispose]();
				}
				if (stopped.signal.aborted) return;
				const started = await rojoCommandService.watch(
					selection.value,
					{
						command: step.command,
						flags: plan.flags,
						cwd: plan.cwd,
						project: plan.project,
						signal: stopped.signal,
						beforeRestart: () => session.refresh(),
					}
				);
				if (stopped.signal.aborted) {
					if (started.isOk()) started.value[Symbol.dispose]();
					return;
				}
				if (started.isErr()) {
					rojoProject = undefined;
					log.rojo(started, plan.target);
					return;
				}
				const watch = started.value;
				rojo = watch;
				watch.onDidRun((run) => {
					if (step.prints)
						for (const { stdout } of run.messages)
							if (stdout !== undefined) logService.print(stdout);
					log.rojo(ok(run), plan.target);
				}, rojoListeners);
				watch.onDidRestart(() => log.restarted(), rojoListeners);
				watch.onDidExit(({ failure }) => {
					if (failure) failed.complete(failure);
				}, rojoListeners);
			});

		store.add(
			session.onDidUpdate((update) => {
				log.update(update);
				const { step } = this;
				if (step === undefined) return;
				const planned = step.plan(selection.value);
				if (planned.isErr()) {
					log.error(planned.error);
					return;
				}
				const plan = planned.value;
				if (
					plan === undefined ||
					rojoProject === plan.project.projectFile ||
					!update.reports.some(
						({ outcome }) =>
							isWritten(outcome) &&
							outcome.config.id === plan.project.id
					)
				)
					return;
				rojoProject = plan.project.projectFile;
				startRojo(step, plan).catch((error) =>
					log.error(ErrorUtils.fromUnknown(error))
				);
			})
		);
		store.add(session.onDidError((error) => log.error(error)));
		let failure: Error | undefined;
		try {
			const started = await session.start();
			if (started.isErr()) return started;
			failure = await Promise.race([
				aborted(shutdown).then(() => undefined),
				failed.p,
			]);
		} finally {
			stopped.abort();
			await rojoStarts.queue(async () => {
				await rojo?.terminate();
				rojo?.[Symbol.dispose]();
			});
			await session.stop();
		}
		if (failure) {
			log.error(failure);
			log.end(`${this.step?.command ?? this.command} --watch failed.`);
			return err(new ReportedError(failure));
		}
		log.end();
		return ok(undefined);
	}
}
