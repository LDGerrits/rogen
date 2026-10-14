import { DeferredPromise, Sequencer } from "../../base/async.js";
import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { Result, ok } from "../../base/result.js";
import { isWritten } from "../../domain/build/build.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { ProjectChoice } from "../../domain/config/project-choice.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";
import { WatchService } from "../../domain/watch/watch-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { oneProject } from "./one-project.js";
import { WatchJsonLog, WatchLog, WatchReporter } from "./watch-log.js";

/** `rogen build --watch`: builds, then rebuilds whenever sources or configs change, and runs Rojo's build after each write when asked to. */
export interface RojoWatchTarget {
	/** Rojo's flags for the build. */
	readonly flags: readonly string[];
	readonly output?: string;
	readonly plugin?: string;
}

export class BuildWatch {
	constructor(
		private readonly accessor: ServicesAccessor,
		private readonly refs: readonly string[],
		private readonly json: boolean,
		/** What to build with Rojo after each write, when the files are also to be built into a place or plugin. */
		private readonly rojo: RojoWatchTarget | undefined
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
		const cwd = accessor.get(EnvironmentService).cwd;
		const log: WatchReporter = this.json
			? new WatchJsonLog(logService)
			: new WatchLog(logService, cwd, "build --watch");

		const stopped = new AbortController();
		store.add({ [Symbol.dispose]: () => stopped.abort() });
		const selection = await configService.select(this.refs);
		if (selection.isErr()) return selection;
		for (const note of selection.value.notes) logService.warn(note);
		if (this.rojo !== undefined) {
			const unique = oneProject(
				accessor.get(RojoCommandService),
				selection.value
			);
			if (unique.isErr()) return unique;
		}
		const watched = watchService.watch(selection.value);
		if (watched.isErr()) return watched;
		const session = store.add(watched.value);
		if (shutdown.isSettled) return ok(undefined);
		log.begin(session.configs, selection.value.home);

		const rojoRuns = new Sequencer();
		let rojoWaiting = false;
		store.add(
			session.onDidUpdate((update) => {
				log.update(update);
				const { rojo } = this;
				if (rojo === undefined) return;
				const chosen = ProjectChoice.read(
					selection.value.configs,
					selection.value.named
				).map(({ id }) => id);
				if (
					!update.reports.some(
						({ build }) =>
							isWritten(build) && chosen.includes(build.config.id)
					)
				)
					return;
				if (rojoWaiting) return;
				rojoWaiting = true;
				rojoRuns
					.queue(async () => {
						rojoWaiting = false;
						const ran = await accessor
							.get(RojoCommandService)
							.run(selection.value, {
								command: "build",
								flags: rojo.flags,
								cwd,
								signal: stopped.signal,
							});
						if (stopped.signal.aborted) return;
						log.rojo(ran, { cwd, ...rojo });
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
