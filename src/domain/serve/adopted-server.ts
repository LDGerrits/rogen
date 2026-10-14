import { RunOnceScheduler } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { ServedTarget, ServerExitEvent } from "./serve-service.js";
import { ServerProbe } from "./server-probe.js";
import { RunningServer } from "./started-server.js";

/** How often an adopted server is asked whether it still serves. */
const ADOPTED_POLL_MS = 2_000;

/** How many polls in a row must find nothing listening before the server counts as stopped, so a restart or a busy moment is not one. */
const REFUSED_POLLS_TO_STOP = 2;

/** What happens to an adopted server, told to the session that adopted it. */
interface AdoptedServerListener {
	/** It stopped answering for its project. */
	stopped(stop: ServerExitEvent): void;
	/** A step of its own failed unexpectedly. */
	failed(error: Error): void;
}

/** A server no serve started that serves a target's project; its process is out of sight, so its port is asked until it stops. */
export class AdoptedServer extends AbstractDisposable implements RunningServer {
	private ending = false;
	private refused = 0;
	private readonly poll: RunOnceScheduler;

	constructor(
		readonly target: ServedTarget,
		private readonly probe: ServerProbe,
		private readonly listener: AdoptedServerListener
	) {
		super();
		this.poll = this._register(
			new RunOnceScheduler(() => this.ask(), ADOPTED_POLL_MS)
		);
		this.poll.schedule();
	}

	/** Stops asking its port; the server itself runs on. */
	async terminate(): Promise<void> {
		this.ending = true;
		this.poll.cancel();
	}

	async retire(): Promise<void> {
		await this.terminate();
		this[Symbol.dispose]();
	}

	/** Nothing to drop: no serve recorded it. */
	async unrecord(): Promise<void> {}

	/** Another session or project on the port is another server; nothing listening twice in a row is none; a slow answer is neither. */
	private ask(): void {
		const { target } = this;
		const { servedBy } = target;
		this.probe
			.probe(target.address, servedBy.server)
			.then((state) => {
				if (this.ending) return;
				if (state.kind === "taken") {
					this.poll.schedule();
					return;
				}
				const replaced =
					state.kind === "serving" &&
					(state.info.project !== target.project ||
						state.info.session !== servedBy.session);
				this.refused = state.kind === "free" ? this.refused + 1 : 0;
				if (replaced || this.refused >= REFUSED_POLLS_TO_STOP) {
					this.ending = true;
					this.listener.stopped({ target, interrupted: false });
					return;
				}
				this.poll.schedule();
			})
			.catch((error) => {
				this.listener.failed(ErrorUtils.fromUnknown(error));
				if (!this.ending) this.poll.schedule();
			});
	}
}
