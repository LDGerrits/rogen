import { RunOnceScheduler } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { ServedTarget, ServerExitEvent } from "./serve-service.js";
import { ServerProbe } from "./server-probe.js";
import { RunningServer } from "./started-server.js";

const ADOPTED_POLL_MS = 2_000;

const REFUSED_POLLS_TO_STOP = 2;

interface AdoptedServerListener {
	stopped(stop: ServerExitEvent): void;
	failed(error: Error): void;
}

/** A server that serves a target's project but that no serve started; only its port can be asked. */
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

	async unrecord(): Promise<void> {}

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
