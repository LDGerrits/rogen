import { randomUUID } from "crypto";
import path from "path";
import { DeferredPromise, Sequencer } from "../../base/async.js";
import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { Result, ok, tryWithAsync } from "../../base/result.js";
import { isWritten } from "../../domain/write/write.js";
import { ConfigService } from "../../domain/config/config-service.js";
import {
	RojoCommandRun,
	RojoCommandService,
} from "../../domain/runner/rojo-command-service.js";
import { WatchService } from "../../domain/watch/watch-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { RojoPlan, RojoStep } from "./rojo-step.js";
import {
	PrintedWatchLog,
	WatchJsonLog,
	WatchLog,
	WatchReporter,
} from "./watch-log.js";

/** `rogen build --watch`, `rogen write --watch` and `rogen sourcemap --watch`: writes, then rewrites whenever sources or configs change, and runs Rojo after each write when asked to. */
export class WriteWatch {
	constructor(
		private readonly accessor: ServicesAccessor,
		private readonly refs: readonly string[],
		private readonly json: boolean,
		/** What to run Rojo for after each write, when the files are not all that is wanted. */
		private readonly step: RojoStep | undefined,
		/** The command the header names when no Rojo step does. */
		private readonly command = "build"
	) {}

	/** What Rojo wrote to `file` in place of the screen, printed when its run succeeded. */
	private async print(
		file: string,
		ran: Result<RojoCommandRun, Error>,
		stopped: AbortController
	): Promise<void> {
		const { accessor } = this;
		const fileSystemService = accessor.get(FileSystemService);
		if (ran.isOk() && !ran.value.failure && !stopped.signal.aborted) {
			const text = await tryWithAsync(() =>
				fileSystemService.readFile(file)
			);
			if (text.isOk())
				accessor.get(LogService).print(text.value.trimEnd());
			else
				accessor
					.get(LogService)
					.error(
						ErrorUtils.wrap(
							"Failed to read the sourcemap Rojo wrote",
							text.error
						)
					);
		}
		await fileSystemService.delete(file).catch(() => undefined);
	}

	/** Runs until `shutdown` settles; `store` is the caller's, and holds what the run subscribes to. */
	async run(
		store: DisposableStore,
		shutdown: DeferredPromise<void>
	): Promise<Result<void, Error>> {
		const { accessor } = this;
		const logService = accessor.get(LogService);
		if (this.step && !this.json) logService.reserveStdout();
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
		const log: WatchReporter = this.json
			? new WatchJsonLog(logService, cwd)
			: printing
				? new PrintedWatchLog(logService, cwd)
				: new WatchLog(
						logService,
						cwd,
						`${this.step?.command ?? this.command} --watch`
					);
		const watched = watchService.watch(
			selection.value,
			this.step && {
				contentEdits: {
					ignoring:
						planned?.target.output === undefined
							? []
							: [
									path.resolve(
										planned.target.cwd,
										planned.target.output
									),
								],
				},
			}
		);
		if (watched.isErr()) return watched;
		const session = store.add(watched.value);
		if (shutdown.isSettled) return ok(undefined);
		log.begin(session.configs, selection.value.home);

		const rojoRuns = new Sequencer();
		const waiting = new Set<string>();
		store.add(
			session.onDidUpdate((update) => {
				log.update(update);
				const { step } = this;
				if (step === undefined || update.cause.kind === "compiled")
					return;
				const planned = step.plan(selection.value);
				if (planned.isErr()) {
					log.error(planned.error);
					return;
				}
				const plan = planned.value;
				if (plan === undefined) return;
				const id = plan.project.id;
				if (
					!update.reports.some(
						({ outcome }) =>
							isWritten(outcome) && outcome.config.id === id
					) ||
					waiting.has(id)
				)
					return;
				waiting.add(id);
				rojoRuns
					.queue(async () => {
						waiting.delete(id);
						const tmp = path.join(
							environment.tmpDir,
							`rogen-${step.command}-${randomUUID()}.json`
						);
						const ran = await accessor
							.get(RojoCommandService)
							.run(selection.value, {
								command: step.command,
								flags: plan.printed
									? [...plan.flags, "--output", tmp]
									: plan.flags,
								cwd: plan.cwd,
								project: plan.project,
								signal: stopped.signal,
							});
						if (plan.printed) await this.print(tmp, ran, stopped);
						if (stopped.signal.aborted) return;
						log.rojo(ran, plan.target);
					})
					.catch((error) => log.error(ErrorUtils.fromUnknown(error)));
			})
		);
		store.add(session.onDidError((error) => log.error(error)));
		try {
			const started = await session.start();
			if (started.isErr()) return started;
			await shutdown.p;
		} finally {
			stopped.abort();
			await session.stop();
			await rojoRuns.queue(async () => {});
		}
		log.end();
		return ok(undefined);
	}
}
