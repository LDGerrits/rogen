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

/** Windows runs a batch file only through its shell. */
const needsShell = (file: string) => isWindows && /\.(cmd|bat)$/i.test(file);

/** An argument as `cmd.exe` reads it back as one word. */
const shellQuoted = (arg: string) => `"${arg.replace(/"/g, '""')}"`;

/** Runs a batch file through `cmd.exe` with the line quoted here, which Node's own `shell` option warns against. */
function launch(
	file: string,
	args: readonly string[]
): {
	readonly command: string;
	readonly args: string[];
	readonly windowsVerbatimArguments: boolean;
} {
	return needsShell(file)
		? {
				command: process.env.ComSpec ?? "cmd.exe",
				args: [
					"/d",
					"/s",
					"/c",
					`"${[file, ...args].map(shellQuoted).join(" ")}"`,
				],
				windowsVerbatimArguments: true,
			}
		: { command: file, args: [...args], windowsVerbatimArguments: false };
}

class NativeChildProcess extends AbstractDisposable implements ChildProcess {
	private readonly _onDidExit = this._register(new Emitter<ProcessExit>());
	readonly onDidExit: Event<ProcessExit> = this._onDidExit.event;

	private exit: ProcessExit | undefined;
	private readonly exited: Promise<ProcessExit>;
	private terminating: Promise<ProcessExit> | undefined;

	constructor(private readonly child: childProcess.ChildProcess) {
		super();
		this.exited = new Promise((resolve) => {
			const finish = (exit: ProcessExit) => {
				if (this.exit) return;
				this.exit = exit;
				resolve(exit);
				this._onDidExit.fire(exit);
			};
			child.once("exit", (code, signal) => finish({ code, signal }));
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
		options: { readonly cwd: string; readonly timeout: number }
	): Promise<Result<ProcessOutput, Error>> {
		const run = launch(file, args);
		return new Promise((resolve) => {
			childProcess.execFile(
				run.command,
				run.args,
				{
					cwd: options.cwd,
					env: this.env,
					windowsVerbatimArguments: run.windowsVerbatimArguments,
					timeout: options.timeout,
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
		const run = launch(file, args);
		const output = options.output === "inherit" ? "inherit" : 2;
		return new NativeChildProcess(
			childProcess.spawn(run.command, run.args, {
				cwd: options.cwd,
				env: this.env,
				windowsVerbatimArguments: run.windowsVerbatimArguments,
				stdio: ["ignore", output, output],
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
