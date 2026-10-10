import { AbstractDisposable } from "../../../base/disposable.js";
import { Emitter, Event } from "../../../base/event.js";
import { Result, err, ok } from "../../../base/result.js";
import {
	ChildProcess,
	ProcessExit,
	ProcessOutput,
	ProcessService,
	SpawnOptions,
} from "../process-service.js";

export class MockChildProcess
	extends AbstractDisposable
	implements ChildProcess
{
	private readonly _onDidOutput = this._register(new Emitter<string>());
	readonly onDidOutput: Event<string> = this._onDidOutput.event;

	private readonly _onDidExit = this._register(new Emitter<ProcessExit>());
	readonly onDidExit: Event<ProcessExit> = this._onDidExit.event;

	exitedWith: ProcessExit | undefined;
	terminated = false;

	constructor(
		readonly file: string,
		readonly args: readonly string[],
		readonly options: SpawnOptions
	) {
		super();
	}

	print(text: string): void {
		this._onDidOutput.fire(text);
	}

	exit(exit: ProcessExit): void {
		if (this.exitedWith) return;
		this.exitedWith = exit;
		this._onDidExit.fire(exit);
	}

	async terminate(): Promise<ProcessExit> {
		this.terminated = true;
		this.exit({ code: null, signal: "SIGTERM" });
		return this.exitedWith!;
	}

	override [Symbol.dispose](): void {
		void this.terminate();
		super[Symbol.dispose]();
	}
}
export class MockProcessService implements ProcessService {
	declare readonly _serviceBrand: undefined;

	readonly spawned: MockChildProcess[] = [];
	readonly execs: {
		file: string;
		args: readonly string[];
		cwd: string;
		signal?: AbortSignal;
	}[] = [];

	constructor(
		readonly installed: Map<string, string> = new Map(),
		readonly outputs: Map<string, ProcessOutput> = new Map()
	) {}

	async which(command: string): Promise<string | undefined> {
		return this.installed.get(command);
	}

	async exec(
		file: string,
		args: readonly string[],
		options: { readonly cwd: string; readonly signal?: AbortSignal }
	): Promise<Result<ProcessOutput, Error>> {
		this.execs.push({
			file,
			args,
			cwd: options.cwd,
			signal: options.signal,
		});
		const output = this.outputs.get(file);
		return output ? ok(output) : err(new Error(`spawn ${file} ENOENT`));
	}

	spawn(
		file: string,
		args: readonly string[],
		options: SpawnOptions
	): MockChildProcess {
		const child = new MockChildProcess(file, args, options);
		this.spawned.push(child);
		return child;
	}
}
