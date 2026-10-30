import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import {
	RojoCommandRun,
	RojoWatch,
	RojoWatchExitEvent,
} from "./rojo-command-service.js";
import {
	RojoRestartEvent,
	SupervisedExitEvent,
	SupervisedRojoProcess,
	crashedAgain,
	exitHow,
} from "./rojo-runner.js";
import { RojoServer, ServerMessage } from "./rojo-server.js";

/** A Rojo that runs its command with `--watch`, read into one run per build. */
export class WatchingRojo extends AbstractDisposable implements RojoWatch {
	private readonly _onDidRun = this._register(new Emitter<RojoCommandRun>());
	readonly onDidRun: Event<RojoCommandRun> = this._onDidRun.event;

	private readonly _onDidExit = this._register(
		new Emitter<RojoWatchExitEvent>()
	);
	readonly onDidExit: Event<RojoWatchExitEvent> = this._onDidExit.event;

	readonly onDidRestart: Event<RojoRestartEvent>;

	private readonly child: SupervisedRojoProcess;
	private messages: ServerMessage[] = [];
	private stopping = false;

	/** Takes `child`, a Rojo already started with `--watch`, to own. */
	constructor(
		private readonly project: ResolvedConfig,
		child: SupervisedRojoProcess,
		/** The failure of a build, from the lines of the error Rojo printed. */
		private readonly failed: (said: readonly string[]) => DiagnosticsError
	) {
		super();
		this.child = this._register(child);
		this.onDidRestart = this.child.onDidRestart;
		this._register(
			this.child.onDidRestart(() => {
				this.messages = [];
			})
		);
		this._register(
			this.child.onDidMessage((message) => this.read(message))
		);
		this._register(
			this.child.onDidExit((exit) => {
				if (this.stopping) this._onDidExit.fire({});
				else this._onDidExit.fire({ failure: this.failureOf(exit) });
			})
		);
	}

	async terminate(): Promise<void> {
		this.stopping = true;
		await this.child.terminate();
	}

	private read(message: ServerMessage): void {
		this.messages.push(message);
		if (message.severity === "error") {
			this.finish(
				this.failed([message.text, ...(message.details ?? [])])
			);
			return;
		}
		if (
			message.stdout !== undefined &&
			RojoServer.endsBuild(message.text)
		) {
			this.child.markReady();
			this.finish();
		}
	}

	private finish(failure?: DiagnosticsError): void {
		const messages = this.messages;
		this.messages = [];
		this._onDidRun.fire({
			project: this.project,
			messages,
			...(failure && { failure }),
		});
	}

	private failureOf({ exit, gaveUp }: SupervisedExitEvent): DiagnosticsError {
		const { label, file } = this.project;
		if (gaveUp)
			return new DiagnosticsError([
				crashedAgain(`watching ${label}`, file, exit, gaveUp),
			]);
		return new DiagnosticsError(
			[
				errorDiagnostic(
					"rojo.commandFailed",
					{ resource: this.project.projectFile },
					`Rojo stopped watching ${label} (${exitHow(exit)}).`
				),
			],
			"project"
		);
	}
}
