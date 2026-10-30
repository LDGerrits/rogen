import { DeferredPromise, Sequencer } from "../../base/async.js";
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
import {
	ExitCodeError,
	ReportedError,
} from "../../platform/commands/commands.js";
import {
	LifecycleService,
	exitCodeOfSignal,
} from "../../platform/lifecycle/lifecycle-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { RojoPlan, RojoStep } from "./rojo-step.js";
import {
	PrintedWatchLog,
	WatchJsonLog,
	WatchLog,
	WatchReporter,
} from "./watch-log.js";

/** `rogen build --watch`, `rogen write --watch` and `rogen sourcemap --watch`: writes, then rewrites whenever names, folders or configs change, and runs Rojo's own watch from the first write when asked to. */
export class WriteWatch {
	constructor(
		private readonly accessor: ServicesAccessor,
		private readonly refs: readonly string[],
		private readonly json: boolean,
		/** What to run Rojo's watch for, when the files are not all that is wanted. */
		private readonly step: RojoStep | undefined,
		/** The command the header names when no Rojo step does. */
		private readonly command = "build"
	) {}

	/** Runs until `shutdown` settles; `store` is the caller's, and holds what the run subscribes to. */
	async run(
		store: DisposableStore,
		shutdown: DeferredPromise<void>
	): Promise<Result<void, Error>> {
		const { accessor } = this;
		const logService = accessor.get(LogService);
		const configService = accessor.get(ConfigService);
		const watchService = accessor.get(WatchService);
		const environment = accessor.get(EnvironmentService);
		const { cwd } = environment;
		const stopped = new AbortController();
		store.add({ [Symbol.dispose]: () => stopped.abort() });
		const selection = await configService.select(this.refs);
		if (selection.isErr()) return selection;
		for (const note of selection.value.notes) logService.warn(note);
		let planned: RojoPlan | undefined;
		if (this.step !== undefined) {
			const stepPlan = this.step.plan(selection.value);
			if (stepPlan.isErr()) return stepPlan;
			planned = stepPlan.value;
		}
		const printing = planned?.printed ?? false;
		if (printing && !this.json) logService.reserveStdout();
		const log: WatchReporter = this.json
			? new WatchJsonLog(logService, cwd)
			: printing
				? new PrintedWatchLog(logService, cwd)
				: new WatchLog(
						logService,
						cwd,
						`${this.step?.command ?? this.command} --watch`
					);
		const watched = watchService.watch(selection.value);
		if (watched.isErr()) return watched;
		const session = store.add(watched.value);
		if (shutdown.isSettled) return ok(undefined);
		log.begin(session.configs, selection.value.home);

		const rojoStarts = new Sequencer();
		const failed = new DeferredPromise<Error>();
		let rojo: RojoWatch | undefined;
		let rojoProject: string | undefined;
		const startRojo = (step: RojoStep, plan: RojoPlan) =>
			rojoStarts.queue(async () => {
				const previous = rojo;
				rojo = undefined;
				if (previous) {
					await previous.terminate();
					previous[Symbol.dispose]();
				}
				if (stopped.signal.aborted) return;
				const started = await accessor
					.get(RojoCommandService)
					.watch(selection.value, {
						command: step.command,
						flags: plan.flags,
						cwd: plan.cwd,
						project: plan.project,
						signal: stopped.signal,
						beforeRestart: () => session.refresh(),
					});
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
					if (plan.printed)
						for (const { stdout } of run.messages)
							if (stdout !== undefined) logService.print(stdout);
					log.rojo(ok(run), plan.target);
				});
				watch.onDidRestart(() => log.restarted());
				watch.onDidExit(({ failure }) => {
					if (failure) failed.complete(failure);
				});
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
				shutdown.p.then(() => undefined),
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
		const { signal } = accessor.get(LifecycleService);
		return signal === undefined
			? ok(undefined)
			: err(
					new ReportedError(
						new ExitCodeError(
							exitCodeOfSignal(signal),
							new Error(`Stopped by ${signal}.`)
						)
					)
				);
	}
}
