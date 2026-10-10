import * as childProcess from "child_process";
import fs from "fs/promises";
import path from "path";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils, onUnexpectedError } from "../../base/errors.js";
import { Emitter, Event } from "../../base/event.js";
import { isWindows } from "../../base/platform.js";
import { Result, err, ok } from "../../base/result.js";
import {
	ChildProcess,
	ProcessExit,
	ProcessOutput,
	ProcessService,
	SpawnOptions,
} from "./process-service.js";

/** How long a process asked to stop gets before it is killed. */
const KILL_GRACE_MS = 5_000;

/** How long an exited process's output may take to drain; a process it started can hold the pipes open for good. */
const DRAIN_MS = 250;

/** Windows runs a batch file only through its shell. */
const needsShell = (file: string, windows: boolean) =>
	windows && /\.(cmd|bat)$/i.test(file);

/** An argument as `cmd.exe` reads it back as one word. */
const shellQuoted = (arg: string) => `"${arg.replace(/"/g, '""')}"`;

/** `cmd.exe` expands `%NAME%` even inside quotes, and nothing escapes it there. */
const expandedByShell = (arg: string) => /%[^%]+%/.test(arg);

interface Launch {
	readonly command: string;
	readonly args: string[];
	readonly windowsVerbatimArguments: boolean;
}

/** Runs a batch file through `cmd.exe` with the line quoted here, which Node's own `shell` option warns against; fails for an argument that `cmd.exe` would rewrite. */
export function launch(
	file: string,
	args: readonly string[],
	env: NodeJS.ProcessEnv,
	windows = isWindows
): Result<Launch, Error> {
	if (!needsShell(file, windows))
		return ok({
			command: file,
			args: [...args],
			windowsVerbatimArguments: false,
		});
	const expanded = args.find(expandedByShell);
	if (expanded !== undefined)
		return err(
			new Error(
				`${path.basename(file)} is a batch file, which Windows runs through cmd.exe, and cmd.exe would expand the % in "${expanded}" as a variable. Run the program itself (an .exe), or rename the folder.`
			)
		);
	return ok({
		command: env.ComSpec ?? "cmd.exe",
		args: [
			"/d",
			"/s",
			"/c",
			`"${[file, ...args].map(shellQuoted).join(" ")}"`,
		],
		windowsVerbatimArguments: true,
	});
}

/** A process that never started: it has already failed with `error`. */
class FailedChildProcess extends AbstractDisposable implements ChildProcess {
	private readonly _onDidExit = this._register(new Emitter<ProcessExit>());
	readonly onDidOutput: Event<string> = this._register(new Emitter<string>())
		.event;
	readonly onDidExit: Event<ProcessExit> = this._onDidExit.event;
	private readonly exit: ProcessExit;

	constructor(error: Error) {
		super();
		this.exit = { code: null, signal: null, error };
		queueMicrotask(() => this._onDidExit.fire(this.exit));
	}

	terminate(): Promise<ProcessExit> {
		return Promise.resolve(this.exit);
	}
}

class NativeChildProcess extends AbstractDisposable implements ChildProcess {
	private readonly _onDidOutput = this._register(new Emitter<string>());
	readonly onDidOutput: Event<string> = this._onDidOutput.event;

	private readonly _onDidExit = this._register(new Emitter<ProcessExit>());
	readonly onDidExit: Event<ProcessExit> = this._onDidExit.event;

	private exit: ProcessExit | undefined;
	private readonly exited: Promise<ProcessExit>;
	private terminating: Promise<ProcessExit> | undefined;

	constructor(private readonly child: childProcess.ChildProcess) {
		super();
		for (const stream of [child.stdout, child.stderr]) {
			stream?.setEncoding("utf8");
			stream?.on("data", (text: string) => this._onDidOutput.fire(text));
		}
		this.exited = new Promise((resolve) => {
			const finish = (exit: ProcessExit) => {
				if (this.exit) return;
				this.exit = exit;
				resolve(exit);
				this._onDidExit.fire(exit);
			};
			child.once("exit", (code, signal) => {
				const timer = setTimeout(
					() => finish({ code, signal }),
					DRAIN_MS
				);
				child.once("close", () => {
					clearTimeout(timer);
					finish({ code, signal });
				});
			});
			child.once("error", (error) => {
				if (child.pid === undefined)
					finish({ code: null, signal: null, error });
			});
		});
	}

	terminate(): Promise<ProcessExit> {
		this.terminating ??= this.end();
		return this.terminating;
	}

	private async end(): Promise<ProcessExit> {
		if (this.exit || this.child.pid === undefined) return this.exited;
		if (isWindows) {
			// A toolchain manager's shim starts the real program as its own child, which outlives the shim unless the tree ends.
			await new Promise<void>((resolve) =>
				childProcess.execFile(
					"taskkill",
					["/pid", String(this.child.pid), "/T", "/F"],
					{ windowsHide: true },
					() => resolve()
				)
			);
		} else {
			this.child.kill("SIGTERM");
		}
		const timer = setTimeout(
			() => this.child.kill("SIGKILL"),
			KILL_GRACE_MS
		);
		try {
			return await this.exited;
		} finally {
			clearTimeout(timer);
		}
	}

	override [Symbol.dispose](): void {
		this.terminate().catch(onUnexpectedError);
		super[Symbol.dispose]();
	}
}

export class NativeProcessService implements ProcessService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly env: Readonly<
			Record<string, string | undefined>
		> = process.env
	) {}

	async which(command: string): Promise<string | undefined> {
		const extensions =
			isWindows && path.extname(command) === ""
				? (this.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
						.split(";")
						.filter(Boolean)
				: [""];
		const dirs = (this.env.PATH ?? this.env.Path ?? "")
			.split(path.delimiter)
			.filter(Boolean);
		for (const dir of dirs) {
			for (const extension of extensions) {
				const file = path.join(dir, command + extension);
				if (await this.isExecutable(file)) return file;
			}
		}
		return undefined;
	}

	exec(
		file: string,
		args: readonly string[],
		options: {
			readonly cwd: string;
			readonly timeout: number;
			readonly signal?: AbortSignal;
		}
	): Promise<Result<ProcessOutput, Error>> {
		const launched = launch(file, args, this.env);
		if (launched.isErr()) return Promise.resolve(launched);
		const run = launched.value;
		return new Promise((resolve) => {
			childProcess.execFile(
				run.command,
				run.args,
				{
					cwd: options.cwd,
					env: this.env,
					windowsVerbatimArguments: run.windowsVerbatimArguments,
					timeout: options.timeout,
					signal: options.signal,
					windowsHide: true,
				},
				(error, stdout, stderr) => {
					if (error && typeof error.code !== "number") {
						resolve(err(ErrorUtils.fromUnknown(error)));
						return;
					}
					resolve(
						ok({
							code: error ? (error.code as number) : 0,
							stdout,
							stderr,
						})
					);
				}
			);
		});
	}

	spawn(
		file: string,
		args: readonly string[],
		options: SpawnOptions
	): ChildProcess {
		const launched = launch(file, args, this.env);
		if (launched.isErr()) return new FailedChildProcess(launched.error);
		const run = launched.value;
		return new NativeChildProcess(
			childProcess.spawn(run.command, run.args, {
				cwd: options.cwd,
				env: this.env,
				windowsVerbatimArguments: run.windowsVerbatimArguments,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			})
		);
	}

	private async isExecutable(file: string): Promise<boolean> {
		try {
			const stat = await fs.stat(file);
			if (!stat.isFile()) return false;
			await fs.access(
				file,
				isWindows ? fs.constants.F_OK : fs.constants.X_OK
			);
			return true;
		} catch {
			return false;
		}
	}
}
