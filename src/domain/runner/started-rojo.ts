import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";
import {
	ChildProcess,
	ProcessExit,
} from "../../platform/process/process-service.js";
import { RojoProcess } from "./rojo-runner.js";
import { ServerOutput } from "./server-output.js";
import { ServerMessage, SyncServer } from "./sync-server.js";

export class StartedRojo extends AbstractDisposable implements RojoProcess {
	private readonly _onDidMessage = this._register(
		new Emitter<ServerMessage>()
	);
	readonly onDidMessage: Event<ServerMessage> = this._onDidMessage.event;

	private readonly _onDidConnection = this._register(
		new Emitter<"opened" | "closed">()
	);
	readonly onDidConnection: Event<"opened" | "closed"> =
		this._onDidConnection.event;

	private readonly _onDidExit = this._register(new Emitter<ProcessExit>());
	readonly onDidExit: Event<ProcessExit> = this._onDidExit.event;

	private exited = false;

	get pid(): number | undefined {
		return this.child.pid;
	}

	constructor(
		private readonly child: ChildProcess,
		server: SyncServer
	) {
		super();
		this._register(child);
		const output = this._register(new ServerOutput(server));
		this._register(
			child.onDidOutput(({ line, stream }) =>
				output.readLine(line, stream)
			)
		);
		this._register(
			output.onDidMessage((message) => this._onDidMessage.fire(message))
		);
		this._register(
			output.onDidConnection((change) => {
				if (!this.exited) this._onDidConnection.fire(change);
			})
		);
		this._register(
			child.onDidExit((exit) => {
				this.exited = true;
				output.end();
				this._onDidExit.fire(exit);
			})
		);
	}

	async terminate(): Promise<void> {
		await this.child.terminate();
	}
}
