import { RunOnceScheduler } from "../../base/async.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { ServedTarget, ServerExitEvent } from "./serve-service.js";
import { ServerProbe } from "./server-probe.js";

/** How often an adopted server is asked whether it still serves. */
const ADOPTED_POLL_MS = 2_000;

/** What happens to an adopted server, told to the session that adopted it. */
export interface AdoptedServerListener {
	/** It stopped answering for its project. */
	stopped(stop: ServerExitEvent): void;
	/** A step of its own failed unexpectedly. */
	failed(error: Error): void;
}

/** A server no serve started, which already served a target's project when the session came to serve it: the session builds for it, and asks its port until it stops answering, since it can't see its process. */
export class AdoptedServer extends AbstractDisposable {
	private ending = false;
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

	/** The same session answering for the project means the same server. */
	private ask(): void {
		const { target } = this;
		const { servedBy } = target;
		this.probe
			.probe(target.address, servedBy.server)
			.then((state) => {
				if (this.ending) return;
				const serves =
					state.kind === "serving" &&
					state.info.project === target.project &&
					state.info.session === servedBy.session;
				if (serves) {
					this.poll.schedule();
					return;
				}
				this.ending = true;
				this.listener.stopped({ target, interrupted: false });
			})
			.catch((error) =>
				this.listener.failed(ErrorUtils.fromUnknown(error))
			);
	}
}
