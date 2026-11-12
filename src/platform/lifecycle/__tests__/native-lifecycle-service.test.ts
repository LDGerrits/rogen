import { jest } from "@jest/globals";
import os from "os";
import { DisposableStore } from "../../../base/disposable.js";
import { MockProcessService } from "../../process/__tests__/mock-process-service.js";
import { NativeProcessService } from "../../process/native-process-service.js";
import { NativeLifecycleService } from "../native-lifecycle-service.js";

describe("NativeLifecycleService", () => {
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should fire onWillShutdown when the process receives SIGTERM", () => {
		const service = store.add(
			new NativeLifecycleService(new MockProcessService())
		);
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));

		process.emit("SIGTERM");

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
		"should remember that %s asked for the shutdown",
		(signal) => {
			const service = store.add(
				new NativeLifecycleService(new MockProcessService())
			);
			store.add(service.onWillShutdown(() => undefined));

			process.emit(signal);

			expect(service.signal).toBe(signal);
		}
	);

	it("should name no signal when the reader of the output quit", () => {
		const service = store.add(
			new NativeLifecycleService(new MockProcessService())
		);
		store.add(service.onWillShutdown(() => undefined));

		process.stdout.emit(
			"error",
			Object.assign(new Error("write EPIPE"), { code: "EPIPE" })
		);

		expect(service.signal).toBeUndefined();
	});

	it("should fire onWillShutdown when the terminal closes", () => {
		const service = store.add(
			new NativeLifecycleService(new MockProcessService())
		);
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));

		process.emit("SIGHUP");

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should fire onWillShutdown once when the reader of the output quits", () => {
		const service = store.add(
			new NativeLifecycleService(new MockProcessService())
		);
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));
		const closed = Object.assign(new Error("write EPIPE"), {
			code: "EPIPE",
		});

		process.stdout.emit("error", closed);
		process.stdout.emit("error", closed);

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should leave the signals to the process until something listens", () => {
		const before = process.listenerCount("SIGTERM");

		store.add(new NativeLifecycleService(new MockProcessService()));

		expect(process.listenerCount("SIGTERM")).toBe(before);
	});

	it("should stop listening for signals once disposed", () => {
		const before = process.listenerCount("SIGINT");
		const service = new NativeLifecycleService(new MockProcessService());
		service.onWillShutdown(() => undefined);

		service[Symbol.dispose]();

		expect(process.listenerCount("SIGINT")).toBe(before);
	});

	it("should fire onWillShutdown once for repeated signals and a quit reader", () => {
		const service = store.add(
			new NativeLifecycleService(new MockProcessService())
		);
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));
		const exit = jest
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const write = jest
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);

		process.emit("SIGINT");
		process.stdout.emit(
			"error",
			Object.assign(new Error("write EPIPE"), { code: "EPIPE" })
		);
		process.emit("SIGTERM");
		exit.mockRestore();
		write.mockRestore();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(service.signal).toBe("SIGINT");
	});

	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
	] as const)(
		"should kill the children and exit at once on a second %s",
		(signal, code) => {
			const processes = new MockProcessService();
			const service = store.add(new NativeLifecycleService(processes));
			store.add(service.onWillShutdown(() => undefined));
			const exit = jest
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);
			const write = jest
				.spyOn(process.stderr, "write")
				.mockImplementation(() => true);

			process.emit("SIGINT");
			const stoppedOnFirst = processes.killedAll;
			process.emit(signal);
			const written = write.mock.calls.map(([text]) => String(text));
			const codes = exit.mock.calls.map(([exitCode]) => exitCode);
			exit.mockRestore();
			write.mockRestore();

			expect(stoppedOnFirst).toBe(0);
			expect(processes.killedAll).toBe(1);
			expect(written).toEqual(["Stopping now\n"]);
			expect(codes).toEqual([code]);
		}
	);

	it("should leave the signals to the process once the last listener leaves", () => {
		const signals = process.listenerCount("SIGINT");
		const errors = process.stdout.listenerCount("error");
		const service = store.add(
			new NativeLifecycleService(new MockProcessService())
		);
		const first = service.onWillShutdown(() => undefined);
		const second = service.onWillShutdown(() => undefined);

		first[Symbol.dispose]();
		const whileOneListens = process.listenerCount("SIGINT");
		second[Symbol.dispose]();

		expect(whileOneListens).toBe(signals + 1);
		expect(process.listenerCount("SIGINT")).toBe(signals);
		expect(process.stdout.listenerCount("error")).toBe(errors);
	});

	it("should take the signals again when something listens after the last left", () => {
		const service = store.add(
			new NativeLifecycleService(new MockProcessService())
		);
		service.onWillShutdown(() => undefined)[Symbol.dispose]();
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));

		process.emit("SIGTERM");

		expect(listener).toHaveBeenCalledTimes(1);
	});
	it("should give a listener that comes after the last one left a graceful first signal", async () => {
		const service = store.add(
			new NativeLifecycleService(new MockProcessService())
		);
		const first = service.onWillShutdown(() => undefined);
		process.emit("SIGINT");
		first[Symbol.dispose]();
		await Promise.resolve();
		const exit = jest
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));

		process.emit("SIGINT");
		const exited = exit.mock.calls.length;
		exit.mockRestore();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(exited).toBe(0);
	});

	it("should kill the children on a second signal after every listener left, while they stop", () => {
		const processes = new MockProcessService();
		const service = store.add(new NativeLifecycleService(processes));
		processes.setRunning(true);
		const listening = service.onWillShutdown(() => undefined);
		const exit = jest
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const write = jest
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);

		process.emit("SIGINT");
		listening[Symbol.dispose]();
		process.emit("SIGINT");
		const codes = exit.mock.calls.map(([exitCode]) => exitCode);
		exit.mockRestore();
		write.mockRestore();

		expect(processes.killedAll).toBe(1);
		expect(codes).toEqual([130]);
	});

	it("should still end the children at once on a second signal after a listener came and went while they stop", () => {
		const processes = new MockProcessService();
		const service = store.add(new NativeLifecycleService(processes));
		processes.setRunning(true);
		const first = service.onWillShutdown(() => undefined);
		process.emit("SIGINT");
		first[Symbol.dispose]();
		service.onWillShutdown(() => undefined)[Symbol.dispose]();
		const exit = jest
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const write = jest
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);

		process.emit("SIGINT");
		const written = write.mock.calls.map(([text]) => text);
		exit.mockRestore();
		write.mockRestore();

		expect(processes.killedAll).toBe(1);
		expect(written).toEqual(["Stopping now\n"]);
	});

	it("should give a listener that comes while the children stop a graceful first signal", () => {
		const processes = new MockProcessService();
		const service = store.add(new NativeLifecycleService(processes));
		processes.setRunning(true);
		const first = service.onWillShutdown(() => undefined);
		process.emit("SIGINT");
		first[Symbol.dispose]();
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));
		const exit = jest
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);

		process.emit("SIGINT");
		const exited = exit.mock.calls.length;
		exit.mockRestore();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(processes.killedAll).toBe(0);
		expect(exited).toBe(0);
	});

	it("should leave the signals to the process once the children it stops have stopped", async () => {
		const signals = process.listenerCount("SIGINT");
		const processes = new MockProcessService();
		const service = store.add(new NativeLifecycleService(processes));
		processes.setRunning(true);
		const listening = service.onWillShutdown(() => undefined);
		process.emit("SIGINT");
		listening[Symbol.dispose]();
		const whileStopping = process.listenerCount("SIGINT");

		processes.setRunning(false);

		expect(whileStopping).toBe(signals + 1);
		expect(process.listenerCount("SIGINT")).toBe(signals);
	});
	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
		["SIGHUP", 129],
	] as const)(
		"should kill the children and exit on %s while they run and nothing listens",
		(signal, code) => {
			const processes = new MockProcessService();
			store.add(new NativeLifecycleService(processes));
			processes.setRunning(true);
			const exit = jest
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);
			const write = jest
				.spyOn(process.stderr, "write")
				.mockImplementation(() => true);

			process.emit(signal);
			const written = write.mock.calls.length;
			const codes = exit.mock.calls.map(([exitCode]) => exitCode);
			exit.mockRestore();
			write.mockRestore();

			expect(processes.killedAll).toBe(1);
			expect(written).toBe(0);
			expect(codes).toEqual([code]);
		}
	);

	it("should leave the signals to the process once the children it didn't stop have ended", () => {
		const signals = process.listenerCount("SIGINT");
		const errors = process.stdout.listenerCount("error");
		const processes = new MockProcessService();
		store.add(new NativeLifecycleService(processes));

		processes.setRunning(true);
		const whileRunning = process.listenerCount("SIGINT");
		const errorsWhileRunning = process.stdout.listenerCount("error");
		processes.setRunning(false);

		expect(whileRunning).toBe(signals + 1);
		expect(errorsWhileRunning).toBe(errors);
		expect(process.listenerCount("SIGINT")).toBe(signals);
	});

	it("should keep a graceful first signal for a listener while children run", () => {
		const processes = new MockProcessService();
		const service = store.add(new NativeLifecycleService(processes));
		processes.setRunning(true);
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));
		const exit = jest
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);

		process.emit("SIGINT");
		const exited = exit.mock.calls.length;
		exit.mockRestore();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(processes.killedAll).toBe(0);
		expect(exited).toBe(0);
	});

	it("should end a running child's process group when a signal ends the run", async () => {
		if (process.platform === "win32") return;
		const signals = process.listenerCount("SIGINT");
		const processes = new NativeProcessService();
		store.add(new NativeLifecycleService(processes));
		const child = store.add(
			processes.spawn(
				process.execPath,
				[
					"-e",
					"const grandchild = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' }); console.log(grandchild.pid); setTimeout(() => {}, 60_000)",
				],
				{ cwd: os.tmpdir() }
			)
		);
		const grandchild = await new Promise<number>((resolve) =>
			child.onDidOutput(({ line }) => resolve(Number(line.trim())))
		);
		const exited = new Promise((resolve) => child.onDidExit(resolve));
		const exit = jest
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);

		process.emit("SIGINT");
		const codes = exit.mock.calls.map(([exitCode]) => exitCode);
		exit.mockRestore();

		expect(codes).toEqual([130]);
		expect(await exited).toEqual({ code: null, signal: "SIGKILL" });
		let alive = true;
		for (let tries = 0; tries < 50 && alive; tries++) {
			alive = processes.isRunning(grandchild);
			if (alive) await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(alive).toBe(false);
		expect(process.listenerCount("SIGINT")).toBe(signals);
	});
});
