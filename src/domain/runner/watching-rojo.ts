import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { exitCodeText } from "../../platform/process/process-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoCommandRun, RojoWatch } from "./rojo-command-service.js";
import { RojoProcess } from "./rojo-runner.js";
import { ServerMessage } from "./rojo-server.js";
import {
	RojoRestartEvent,
	SupervisedExitEvent,
	SupervisedRojo,
} from "./supervised-rojo.js";

/** The stdout lines that end one of its builds: a build, a sourcemap file, or a printed sourcemap. */
const FINISHED = [/^Built project to .+$/, /^Created sourcemap at .+$/, /^\{/];

/** A Rojo that runs its command with `--watch`, read into one run per build. */
export class WatchingRojo extends AbstractDisposable implements RojoWatch {
	private readonly _onDidRun = this._register(new Emitter<RojoCommandRun>());
	readonly onDidRun: Event<RojoCommandRun> = this._onDidRun.event;

	private readonly _onDidExit = this._register(
		new Emitter<{ readonly failure?: DiagnosticsError }>()
	);
	readonly onDidExit: Event<{ readonly failure?: DiagnosticsError }> =
		this._onDidExit.event;

	readonly onDidRestart: Event<RojoRestartEvent>;

	private readonly child: SupervisedRojo;
	private messages: ServerMessage[] = [];
	private stopping = false;

	constructor(
		private readonly project: ResolvedConfig,
		start: () => RojoProcess,
		/** The failure of a build, from the lines of the error Rojo printed. */
		private readonly failed: (said: readonly string[]) => DiagnosticsError,
		beforeRestart?: () => Promise<void>
	) {
		super();
		this.child = this._register(
			new SupervisedRojo(start, { beforeRestart })
		);
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
			FINISHED.some((line) => line.test(message.text))
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
		const how =
			exit.error?.message ??
			(exit.code === null
				? `signal ${exit.signal}`
				: `exit code ${exitCodeText(exit.code)}`);
		if (gaveUp) {
			const stopped = `Rojo crashed again right after a restart, so Rogen stopped watching ${label}`;
			return new DiagnosticsError([
				gaveUp.length > 0
					? {
							...errorDiagnostic(
								"rojo.crashed",
								{ resource: file },
								`${stopped}:`
							),
							details: gaveUp,
						}
					: errorDiagnostic(
							"rojo.crashed",
							{ resource: file },
							`${stopped} (${how}).`
						),
			]);
		}
		return new DiagnosticsError(
			[
				errorDiagnostic(
					"rojo.commandFailed",
					{ resource: this.project.projectFile },
					`Rojo stopped watching ${label} (${how}).`
				),
			],
			"project"
		);
	}
}
