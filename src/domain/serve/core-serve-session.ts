import { DeferredPromise, Sequencer } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic, isError } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { isWritten } from "../build/build.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoCompatibility } from "../runner/rojo-compatibility.js";
import { RojoRunner } from "../runner/rojo-runner.js";
import { WatchSession, WatchUpdate } from "../watch/watch-service.js";
import {
	ServeChangeEvent,
	ServePlan,
	ServeSession,
	ServeTarget,
	ServerConnectionEvent,
	ServerOutputEvent,
	ServerExitEvent,
	ServerReadyEvent,
	ServedTarget,
	isServed,
} from "./serve-service.js";
import { ServePorts } from "./serve-ports.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-records.js";
import { RunningServer, StartedServer } from "./started-server.js";
import { AdoptedServer } from "./adopted-server.js";

/** Watches the plan's configs and keeps a started or adopted server for each config to serve. */
export class CoreServeSession
	extends AbstractDisposable
	implements ServeSession
{
	private readonly _onDidUpdate = this._register(new Emitter<WatchUpdate>());
	readonly onDidUpdate: Event<WatchUpdate> = this._onDidUpdate.event;

	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	private readonly _onDidServe = this._register(
		new Emitter<ServerReadyEvent>()
	);
	readonly onDidServe: Event<ServerReadyEvent> = this._onDidServe.event;

	private readonly _onDidConnect = this._register(
		new Emitter<ServerConnectionEvent>()
	);
	readonly onDidConnect: Event<ServerConnectionEvent> =
		this._onDidConnect.event;

	private readonly _onDidOutput = this._register(
		new Emitter<ServerOutputEvent>()
	);
	readonly onDidOutput: Event<ServerOutputEvent> = this._onDidOutput.event;

	private readonly _onDidChange = this._register(
		new Emitter<ServeChangeEvent>()
	);
	readonly onDidChange: Event<ServeChangeEvent> = this._onDidChange.event;

	private readonly _onDidExit = this._register(
		new Emitter<ServerExitEvent>()
	);
	readonly onDidExit: Event<ServerExitEvent> = this._onDidExit.event;

	private readonly servers = new Map<string, RunningServer>();
	private readonly retirements = new Set<Promise<void>>();
	private readonly declined = new Map<
		string,
		{ readonly kind: "refused" | "elsewhere"; readonly address: string }
	>();
	private readonly writtenConfigs = new Set<string>();
	private launched = false;
	private readonly reconciling = new Sequencer();
	private readonly firstUpdate = new DeferredPromise<
		WatchUpdate | Error | undefined
	>();
	private stopping = false;
	private stopped: Promise<void> | undefined;

	constructor(
		private readonly plan: ServePlan,
		private readonly watch: WatchSession,
		private readonly rojoRunner: RojoRunner,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly ports: ServePorts,
		private readonly compatibility: RojoCompatibility
	) {
		super();
		this._register(watch);
		this._register(
			watch.onDidUpdate((update) => {
				for (const { build } of update.reports) {
					if (!isWritten(build)) {
						this.writtenConfigs.delete(build.config.id);
						continue;
					}
					this.writtenConfigs.add(build.config.id);
				}
				if (!this.firstUpdate.isSettled)
					this.firstUpdate.complete(update);
				this._onDidUpdate.fire(update);
				if (this.launched)
					this.reconciling
						.queue(async () => {
							await this.reportIncompatible(update);
							await this.reconcile();
						})
						.catch((error) =>
							this._onDidError.fire(ErrorUtils.fromUnknown(error))
						);
			})
		);
		this._register(
			watch.onDidError((error) => {
				if (!this.firstUpdate.isSettled)
					this.firstUpdate.complete(error);
				this._onDidError.fire(error);
			})
		);
	}

	get targets(): readonly ServeTarget[] {
		return [...this.servers.values()].map(({ target }) => target);
	}

	async start(): Promise<Result<void, Error>> {
		const watching = await this.watch.start();
		if (watching.isErr()) {
			this._onDidError.fire(watching.error);
			return watching;
		}
		const first = await this.firstUpdate.p;
		if (!first || this.stopping) return ok(undefined);
		if (first instanceof Error) return err(first);
		const errors = first.reports.flatMap(({ build }) =>
			build.diagnostics.filter(isError)
		);
		if (errors.length > 0) return err(new DiagnosticsError(errors));
		const incompatible = await this.compatibility.problemsIn(
			this.plan.executable,
			first.reports.flatMap(({ build }) =>
				isWritten(build) ? [build.config.projectFile] : []
			)
		);
		if (incompatible.length > 0) {
			const refusal = new DiagnosticsError(incompatible);
			this._onDidError.fire(refusal);
			return err(refusal);
		}
		for (const target of this.plan.toStart) {
			await this.endOrphanOf(target);
			if (this.stopping) return ok(undefined);
			this.launch(target);
		}
		for (const target of this.plan.alreadyServed)
			if (target.adopted) this.adopt(target);
			else
				this.declined.set(target.config.id, {
					kind: "elsewhere",
					address: target.address.toString(),
				});
		this.launched = true;
		return ok(undefined);
	}

	stop(): Promise<void> {
		this.stopping = true;
		this.stopped ??= (async () => {
			if (!this.firstUpdate.isSettled)
				this.firstUpdate.complete(undefined);
			const servers = [...this.servers.values()];
			await Promise.all([
				...servers.map((server) => server.terminate()),
				...this.retirements,
			]);
			await Promise.allSettled(
				servers.map((server) => server.unrecord())
			);
			await this.watch.stop();
		})();
		return this.stopped;
	}

	override [Symbol.dispose](): void {
		this.stop().catch(onUnexpectedError);
		for (const server of this.servers.values()) server[Symbol.dispose]();
		super[Symbol.dispose]();
	}

	private async reportIncompatible(update: WatchUpdate): Promise<void> {
		const problems = await this.compatibility.problemsIn(
			this.plan.executable,
			update.reports.flatMap(({ build }) =>
				isWritten(build) ? [build.config.projectFile] : []
			)
		);
		if (problems.length > 0)
			this._onDidError.fire(new DiagnosticsError(problems));
	}

	private async reconcile(): Promise<void> {
		const { selection } = this.plan;
		const configs = selection.configs.filter(({ hasPlaces }) => !hasPlaces);
		const wanted = new Set(configs.map(({ id }) => id));
		for (const [file, server] of this.servers) {
			if (this.stopping) return;
			if (!wanted.has(file)) await this.retire(server, "removed");
		}
		for (const file of [...this.declined.keys()])
			if (!wanted.has(file)) this.declined.delete(file);
		for (const config of configs) {
			if (this.stopping) return;
			await this.follow(config);
		}
	}

	private async follow(config: ResolvedConfig): Promise<void> {
		const target = this.ports.targetOf(config);
		const address = target.address.toString();
		const started = this.servers.get(config.id);
		if (started?.target.address.toString() === address) return;
		if (!this.writtenConfigs.has(config.id)) return;

		const others = this.targets.filter(
			(other) => other.config.id !== config.id
		);
		const holder = others.find(
			(other) => other.address.port === target.address.port
		);
		const prior = this.declined.get(config.id);
		const declinedHere =
			prior?.address === address ? prior.kind : undefined;
		if (
			!holder &&
			declinedHere &&
			(await this.stillDeclined(target, declinedHere))
		)
			return;
		const samePort = started?.target.address.port === target.address.port;
		const checked = holder
			? err(this.ports.sharedPort(target, holder))
			: started instanceof StartedServer && samePort
				? ok(target)
				: await this.ports.check(target, others);
		if (this.stopping) return;
		await this.settle(target, started, declinedHere, checked);
	}

	private async settle(
		target: ServeTarget,
		started: RunningServer | undefined,
		declinedHere: "refused" | "elsewhere" | undefined,
		checked: Result<ServeTarget, Diagnostic>
	): Promise<void> {
		const file = target.config.id;
		const address = target.address.toString();
		if (checked.isErr()) {
			if (declinedHere !== "refused")
				this._onDidChange.fire({
					kind: "refused",
					target,
					diagnostic: checked.error,
				});
			this.declined.set(file, { kind: "refused", address });
			return;
		}
		if (started) await this.retire(started, "moved");
		if (isServed(checked.value)) {
			if (declinedHere !== "elsewhere")
				this._onDidChange.fire({
					kind: "servedElsewhere",
					target: checked.value,
				});
			if (checked.value.adopted) {
				this.declined.delete(file);
				this.adopt(checked.value);
			} else this.declined.set(file, { kind: "elsewhere", address });
			return;
		}
		this.declined.delete(file);
		await this.endOrphanOf(checked.value);
		this.launch(checked.value);
	}

	private async stillDeclined(
		target: ServeTarget,
		kind: "refused" | "elsewhere"
	): Promise<boolean> {
		const state = await this.probe.probe(
			target.address,
			this.plan.executable.server
		);
		const ownProject =
			state.kind === "serving" && state.info.project === target.project;
		if (kind === "refused") return state.kind !== "free" && !ownProject;
		return (
			state.kind === "serving" &&
			ownProject &&
			!(await this.ports.ownerEndedFor(target, state.info))
		);
	}

	private async retire(
		server: RunningServer,
		reason: "removed" | "moved"
	): Promise<void> {
		const { target } = server;
		this.servers.delete(target.config.id);
		const retired = server.retire();
		this.retirements.add(retired);
		try {
			await retired;
		} finally {
			this.retirements.delete(retired);
		}
		this._onDidChange.fire({ kind: "retired", target, reason });
	}

	/** Ends the server a `rogen serve` that ended left holding the target's port, so its own can start; leaves it when it is gone by now. */
	private async endOrphanOf(target: ServeTarget): Promise<void> {
		const { orphan } = target;
		if (!orphan?.pid) return;
		const { server } = this.plan.executable;
		const state = await this.probe.probe(target.address, server);
		if (state.kind !== "serving" || state.info.session !== orphan.session)
			return;
		const left = `the ${server.name} (process ${orphan.pid}) that a rogen serve (process ${orphan.owner}) left running`;
		let text = `Ended ${left} when it stopped without ending it.`;
		try {
			await this.rojoRunner.terminateTree(orphan.pid);
		} catch (error) {
			text = `Couldn't end ${left}: ${ErrorUtils.fromUnknown(error).message}`;
		}
		this._onDidOutput.fire({
			target,
			message: { severity: "warning", text },
		});
	}

	private launch(target: ServeTarget): void {
		if (this.stopping) return;
		const server = new StartedServer(
			target,
			this.plan,
			this.rojoRunner,
			this.probe,
			this.records,
			{
				served: (serving) => this._onDidServe.fire(serving),
				said: (said) => this._onDidOutput.fire(said),
				connection: (change) => this._onDidConnect.fire(change),
				stopped: (stop) => this._onDidExit.fire(stop),
				failed: (error) => this._onDidError.fire(error),
			}
		);
		this.servers.set(target.config.id, server);
	}

	private adopt(target: ServedTarget): void {
		if (this.stopping) return;
		const server = new AdoptedServer(target, this.probe, {
			stopped: (stop) => this._onDidExit.fire(stop),
			failed: (error) => this._onDidError.fire(error),
		});
		this.servers.set(target.config.id, server);
	}
}
