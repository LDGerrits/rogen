import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import type { ProcessExit } from "../process-service.js";

class FakeChild extends EventEmitter {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly kill = jest.fn(() => true);

	constructor(readonly pid: number | undefined) {
		super();
	}

	end(code: number | null, signal: NodeJS.Signals | null = null): void {
		this.emit("exit", code, signal);
		this.emit("close", code, signal);
	}
}

let child: FakeChild;
const execFile = jest.fn(
	(
		_file: string,
		_args: string[],
		_options: object,
		done: (error: Error | null, stdout: string, stderr: string) => void
	) => done(null, "", "")
);
const spawn = jest.fn(() => child);
const spawnSync = jest.fn();

jest.unstable_mockModule("../../../base/platform.js", () => ({
	isWindows: true,
	ignoresPathCase: true,
}));
jest.unstable_mockModule("child_process", () => ({
	execFile,
	spawn,
	spawnSync,
}));

const { NativeProcessService } = await import("../native-process-service.js");

const exitOf = (process: {
	onDidExit: (listener: (exit: ProcessExit) => void) => unknown;
}) => new Promise<ProcessExit>((resolve) => process.onDidExit(resolve));

describe("NativeProcessService on Windows", () => {
	const service = new NativeProcessService({ ComSpec: "cmd.exe" });

	beforeEach(() => {
		child = new FakeChild(4242);
		execFile.mockClear();
		spawn.mockClear();
		spawnSync.mockClear();
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	describe("which", () => {
		let dir: string;

		beforeEach(() => {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-which-"));
		});

		afterEach(() => {
			fs.rmSync(dir, { recursive: true, force: true });
		});

		it("should try each extension PATHEXT names", async () => {
			fs.writeFileSync(path.join(dir, "rojo.CMD"), "");
			const found = await new NativeProcessService({
				PATH: dir,
				PATHEXT: ".EXE;.CMD;",
			}).which("rojo");

			expect(found).toBe(path.join(dir, "rojo.CMD"));
		});

		it("should try the extensions Windows runs when PATHEXT is unset", async () => {
			fs.writeFileSync(path.join(dir, "rojo.BAT"), "");

			expect(
				await new NativeProcessService({ PATH: dir }).which("rojo")
			).toBe(path.join(dir, "rojo.BAT"));
		});

		it("should take a command that names its extension as it is", async () => {
			fs.writeFileSync(path.join(dir, "rojo.exe"), "");

			expect(
				await new NativeProcessService({ PATH: dir }).which("rojo.exe")
			).toBe(path.join(dir, "rojo.exe"));
		});
	});

	it("should refuse to run a batch file whose argument cmd.exe would expand", async () => {
		const result = await service.exec("rojo.cmd", ["%PATH%"], {
			cwd: "C:\\repo",
			timeout: 1_000,
		});

		expect(result.isErr() && result.error.message).toContain('"%PATH%"');
		expect(execFile).not.toHaveBeenCalled();
	});

	it("should report a batch file it refuses to start as an exit with an error", async () => {
		const refused = service.spawn("rojo.cmd", ["%PATH%"], {
			cwd: "C:\\repo",
		});

		const exit = await exitOf(refused);

		expect(refused.pid).toBeUndefined();
		expect(exit.error?.message).toContain('"%PATH%"');
		expect(await refused.terminate()).toBe(exit);
		expect(spawn).not.toHaveBeenCalled();
		refused[Symbol.dispose]();
	});

	it("should mark an exit with Windows' Ctrl+C status as interrupted", async () => {
		const running = service.spawn("rojo", [], { cwd: "C:\\repo" });
		const exited = exitOf(running);

		child.end(0xc000013a);

		expect(await exited).toEqual({
			code: 0xc000013a,
			signal: null,
			interrupted: true,
		});
		running[Symbol.dispose]();
	});

	it("should not mark an ordinary exit as interrupted", async () => {
		const running = service.spawn("rojo", [], { cwd: "C:\\repo" });
		const exited = exitOf(running);

		child.end(1);

		expect(await exited).toEqual({ code: 1, signal: null });
		running[Symbol.dispose]();
	});

	it("should end the process tree with taskkill on terminate", async () => {
		const running = service.spawn("rojo", [], { cwd: "C:\\repo" });
		execFile.mockImplementationOnce((_file, _args, _options, done) => {
			done(null, "", "");
			child.end(1);
		});

		const exit = await running.terminate();

		expect(execFile).toHaveBeenCalledWith(
			"taskkill",
			["/pid", "4242", "/T", "/F"],
			{ windowsHide: true },
			expect.any(Function)
		);
		expect(exit.code).toBe(1);
		running[Symbol.dispose]();
	});

	it("should kill a process that outlives taskkill once its grace period is over", async () => {
		jest.useFakeTimers();
		jest.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
		});
		const running = service.spawn("rojo", [], { cwd: "C:\\repo" });
		const ended = running.terminate();
		await jest.advanceTimersByTimeAsync(0);

		child.kill.mockImplementationOnce(() => {
			child.end(null, "SIGKILL");
			return true;
		});
		await jest.advanceTimersByTimeAsync(5_000);

		expect(child.kill).toHaveBeenCalledWith("SIGKILL");
		expect(await ended).toEqual({ code: null, signal: "SIGKILL" });
		running[Symbol.dispose]();
	});

	it("should kill the process tree with taskkill at once, and only while it runs", () => {
		const running = service.spawn("rojo", [], { cwd: "C:\\repo" });

		service.killAll();
		child.end(1);
		service.killAll();

		expect(spawnSync).toHaveBeenCalledTimes(1);
		expect(spawnSync).toHaveBeenCalledWith(
			"taskkill",
			["/pid", "4242", "/T", "/F"],
			{ windowsHide: true }
		);
		running[Symbol.dispose]();
	});

	it("should end the process tree of an id with taskkill", async () => {
		await service.terminateTree(77);

		expect(execFile).toHaveBeenCalledWith(
			"taskkill",
			["/pid", "77", "/T", "/F"],
			{ windowsHide: true },
			expect.any(Function)
		);
	});

	it("should keep waiting for the exit after an error from a process that started", async () => {
		const running = service.spawn("rojo", [], { cwd: "C:\\repo" });
		const changes: boolean[] = [];
		service.onDidChangeRunning((isRunning) => changes.push(isRunning));
		const exit = jest.fn();
		running.onDidExit(exit);

		child.emit("error", new Error("kill EPERM"));
		await Promise.resolve();

		expect(exit).not.toHaveBeenCalled();
		expect(changes).toEqual([]);
		child.end(2);
		expect(exit).toHaveBeenCalledWith({ code: 2, signal: null });
		expect(changes).toEqual([false]);
		running[Symbol.dispose]();
	});

	it("should report the exit once when its output closes after the wait for it", async () => {
		jest.useFakeTimers();
		const running = service.spawn("rojo", [], { cwd: "C:\\repo" });
		const exit = jest.fn();
		running.onDidExit(exit);

		child.emit("exit", 3, null);
		await jest.advanceTimersByTimeAsync(250);
		child.emit("close", 3, null);

		expect(exit).toHaveBeenCalledTimes(1);
		expect(exit).toHaveBeenCalledWith({ code: 3, signal: null });
		running[Symbol.dispose]();
	});
});
