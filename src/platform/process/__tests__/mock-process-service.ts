import { AbstractDisposable } from "../../../base/disposable.js";
import { Emitter, Event } from "../../../base/event.js";
import { Result, err, ok } from "../../../base/result.js";
import { LineBuffer } from "../line-buffer.js";
import {
	ChildProcess,
	OutputLine,
	ProcessExit,
	ProcessOutput,
	ProcessService,
	SpawnOptions,
} from "../process-service.js";

export class MockChildProcess
	extends AbstractDisposable
	implements ChildProcess
{
	private readonly _onDidOutput = this._register(new Emitter<OutputLine>());
	readonly onDidOutput: Event<OutputLine> = this._onDidOutput.event;
	private readonly lines = new LineBuffer();
	private readonly errorLines = new LineBuffer();

	private readonly _onDidExit = this._register(new Emitter<ProcessExit>());
	readonly onDidExit: Event<ProcessExit> = this._onDidExit.event;

	exitedWith: ProcessExit | undefined;
	terminated = false;

	constructor(
		readonly file: string,
		readonly args: readonly string[],
		readonly options: SpawnOptions,
		readonly pid: number | undefined = undefined
	) {
		super();
	}

	print(text: string): void {
		for (const line of this.lines.push(text)) this.say(line, "stdout");
	}

	printError(text: string): void {
		for (const line of this.errorLines.push(text)) this.say(line, "stderr");
	}

	private say(line: string, stream: OutputLine["stream"]): void {
		this._onDidOutput.fire({ line, stream });
	}

	exit(exit: ProcessExit): void {
		if (this.exitedWith) return;
		this.exitedWith = exit;
		const last = this.lines.flush();
		if (last !== undefined) this.say(last, "stdout");
		const lastError = this.errorLines.flush();
		if (lastError !== undefined) this.say(lastError, "stderr");
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
	/** The ids of processes started outside this service, that `isRunning` reports. */
	readonly running = new Set<number>();
	readonly terminatedTrees: number[] = [];
	private nextPid = 1000;
	private readonly spawnWaiters: ((child: MockChildProcess) => void)[] = [];
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

	isRunning(pid: number): boolean {
		return this.running.has(pid);
	}

	async terminateTree(pid: number): Promise<void> {
		this.terminatedTrees.push(pid);
		this.running.delete(pid);
	}

	/** Resolves with the next process spawned. */
	nextSpawned(): Promise<MockChildProcess> {
		return new Promise((resolve) => this.spawnWaiters.push(resolve));
	}

	spawn(
		file: string,
		args: readonly string[],
		options: SpawnOptions
	): MockChildProcess {
		const child = new MockChildProcess(file, args, options, this.nextPid++);
		this.spawned.push(child);
		for (const resolve of this.spawnWaiters.splice(0)) resolve(child);
		return child;
	}
}
