import { jest } from "@jest/globals";
import os from "os";
import { DeferredPromise } from "../../../base/async.js";
import { DisposableStore } from "../../../base/disposable.js";
import { Emitter } from "../../../base/event.js";
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
		const service = store.add(new NativeLifecycleService());
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));

		process.emit("SIGTERM");

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
		"should remember that %s asked for the shutdown",
		(signal) => {
			const service = store.add(new NativeLifecycleService());
			store.add(service.onWillShutdown(() => undefined));

			process.emit(signal);

			expect(service.signal).toBe(signal);
		}
	);

	it("should name no signal when the reader of the output quit", () => {
		const service = store.add(new NativeLifecycleService());
		store.add(service.onWillShutdown(() => undefined));

		process.stdout.emit(
			"error",
			Object.assign(new Error("write EPIPE"), { code: "EPIPE" })
		);

		expect(service.signal).toBeUndefined();
	});

	it("should fire onWillShutdown when the terminal closes", () => {
		const service = store.add(new NativeLifecycleService());
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));

		process.emit("SIGHUP");

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("should fire onWillShutdown once when the reader of the output quits", () => {
		const service = store.add(new NativeLifecycleService());
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

		store.add(new NativeLifecycleService());

		expect(process.listenerCount("SIGTERM")).toBe(before);
	});

	it("should stop listening for signals once disposed", () => {
		const before = process.listenerCount("SIGINT");
		const service = new NativeLifecycleService();
		service.onWillShutdown(() => undefined);

		service[Symbol.dispose]();

		expect(process.listenerCount("SIGINT")).toBe(before);
	});

	it("should fire onWillShutdown once for repeated signals and a quit reader", () => {
		const service = store.add(new NativeLifecycleService());
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
			const stopNow = jest.fn();
			const service = store.add(new NativeLifecycleService(stopNow));
			store.add(service.onWillShutdown(() => undefined));
			const exit = jest
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);
			const write = jest
				.spyOn(process.stderr, "write")
				.mockImplementation(() => true);

			process.emit("SIGINT");
			const stoppedOnFirst = stopNow.mock.calls.length;
			process.emit(signal);
			const written = write.mock.calls.map(([text]) => String(text));
			const codes = exit.mock.calls.map(([exitCode]) => exitCode);
			exit.mockRestore();
			write.mockRestore();

			expect(stoppedOnFirst).toBe(0);
			expect(stopNow).toHaveBeenCalledTimes(1);
			expect(written).toEqual(["Stopping now\n"]);
			expect(codes).toEqual([code]);
		}
	);

	it("should leave the signals to the process once the last listener leaves", () => {
		const signals = process.listenerCount("SIGINT");
		const errors = process.stdout.listenerCount("error");
		const service = store.add(new NativeLifecycleService());
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
		const service = store.add(new NativeLifecycleService());
		service.onWillShutdown(() => undefined)[Symbol.dispose]();
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));

		process.emit("SIGTERM");

		expect(listener).toHaveBeenCalledTimes(1);
	});
	it("should give a listener that comes after the last one left a graceful first signal", async () => {
		const service = store.add(new NativeLifecycleService());
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
		const stopNow = jest.fn();
		const stopped = new DeferredPromise<void>();
		const service = store.add(
			new NativeLifecycleService(stopNow, () => stopped.p)
		);
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

		expect(stopNow).toHaveBeenCalledTimes(1);
		expect(codes).toEqual([130]);
	});

	it("should give a listener that comes while the children stop a graceful first signal", () => {
		const stopNow = jest.fn();
		const stopped = new DeferredPromise<void>();
		const service = store.add(
			new NativeLifecycleService(stopNow, () => stopped.p)
		);
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
		expect(stopNow).not.toHaveBeenCalled();
		expect(exited).toBe(0);
	});

	it("should leave the signals to the process once the children it stops have stopped", async () => {
		const signals = process.listenerCount("SIGINT");
		const stopped = new DeferredPromise<void>();
		const service = store.add(
			new NativeLifecycleService(
				() => undefined,
				() => stopped.p
			)
		);
		const listening = service.onWillShutdown(() => undefined);
		process.emit("SIGINT");
		listening[Symbol.dispose]();
		const whileStopping = process.listenerCount("SIGINT");

		stopped.complete();
		await stopped.p;
		await Promise.resolve();

		expect(whileStopping).toBe(signals + 1);
		expect(process.listenerCount("SIGINT")).toBe(signals);
	});
	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
		["SIGHUP", 129],
	] as const)(
		"should pass %s on to the children while they run and nothing listens, and exit with its code once they ended",
		async (signal, code) => {
			const stopNow = jest.fn();
			const forward = jest.fn();
			const stopped = new DeferredPromise<void>();
			const running = store.add(new Emitter<boolean>());
			store.add(
				new NativeLifecycleService(
					stopNow,
					() => stopped.p,
					running.event,
					forward
				)
			);
			running.fire(true);
			const exit = jest
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);

			process.emit(signal);
			await Promise.resolve();
			const killedBefore = stopNow.mock.calls.length;
			const exitedBefore = exit.mock.calls.length;
			running.fire(false);
			stopped.complete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			const codes = exit.mock.calls.map(([exitCode]) => exitCode);
			exit.mockRestore();

			expect(forward.mock.calls).toEqual([[signal]]);
			expect(killedBefore).toBe(0);
			expect(exitedBefore).toBe(0);
			expect(codes).toEqual([code]);
		}
	);

	it("should kill the children and exit at once on a second signal while they end", async () => {
		const stopNow = jest.fn();
		const stopped = new DeferredPromise<void>();
		const running = store.add(new Emitter<boolean>());
		store.add(
			new NativeLifecycleService(
				stopNow,
				() => stopped.p,
				running.event,
				() => undefined
			)
		);
		running.fire(true);
		const exit = jest
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const write = jest
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);

		process.emit("SIGINT");
		process.emit("SIGTERM");
		const written = write.mock.calls.map(([text]) => String(text));
		const codes = exit.mock.calls.map(([exitCode]) => exitCode);
		write.mockRestore();
		stopped.complete();
		await new Promise((resolve) => setTimeout(resolve, 50));
		const laterCodes = exit.mock.calls.map(([exitCode]) => exitCode);
		exit.mockRestore();

		expect(stopNow).toHaveBeenCalledTimes(1);
		expect(written).toEqual(["Stopping now\n"]);
		expect(codes).toEqual([143]);
		expect(laterCodes).toEqual([143]);
	});

	it("should leave the signals to the process once the children it didn't stop have ended", () => {
		const signals = process.listenerCount("SIGINT");
		const errors = process.stdout.listenerCount("error");
		const running = store.add(new Emitter<boolean>());
		store.add(
			new NativeLifecycleService(
				() => undefined,
				() => Promise.resolve(),
				running.event
			)
		);

		running.fire(true);
		const whileRunning = process.listenerCount("SIGINT");
		const errorsWhileRunning = process.stdout.listenerCount("error");
		running.fire(false);

		expect(whileRunning).toBe(signals + 1);
		expect(errorsWhileRunning).toBe(errors);
		expect(process.listenerCount("SIGINT")).toBe(signals);
	});

	it("should keep a graceful first signal for a listener while children run", () => {
		const stopNow = jest.fn();
		const running = store.add(new Emitter<boolean>());
		const service = store.add(
			new NativeLifecycleService(
				stopNow,
				() => Promise.resolve(),
				running.event
			)
		);
		running.fire(true);
		const listener = jest.fn();
		store.add(service.onWillShutdown(listener));
		const exit = jest
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);

		process.emit("SIGINT");
		const exited = exit.mock.calls.length;
		exit.mockRestore();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(stopNow).not.toHaveBeenCalled();
		expect(exited).toBe(0);
	});

	describe("with real children", () => {
		const until = async (done: () => boolean) => {
			for (let tries = 0; tries < 100 && !done(); tries++)
				await new Promise((resolve) => setTimeout(resolve, 20));
		};

		const start = (processes: NativeProcessService, script: string) => {
			const child = store.add(
				processes.spawn(process.execPath, ["-e", script], {
					cwd: os.tmpdir(),
				})
			);
			const lines: string[] = [];
			const ready = new Promise<void>((resolve) =>
				child.onDidOutput(({ line }) => {
					lines.push(line.trim());
					resolve();
				})
			);
			const exited = new Promise((resolve) => child.onDidExit(resolve));
			return { lines, ready, exited };
		};

		const lifecycleOf = (processes: NativeProcessService) =>
			store.add(
				new NativeLifecycleService(
					() => processes.killAll(),
					() => processes.stopped(),
					processes.onDidChangeRunning,
					(signal) => processes.signalAll(signal)
				)
			);

		it("should give a running child the signal, and exit with its code once the child ended", async () => {
			if (process.platform === "win32") return;
			const processes = new NativeProcessService(process.env, 5_000);
			lifecycleOf(processes);
			const child = start(
				processes,
				"process.on('SIGINT', () => { console.log('interrupted'); process.exit(0) }); console.log('ready'); setTimeout(() => {}, 60_000)"
			);
			await child.ready;
			const exit = jest
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);

			process.emit("SIGINT");
			const exitedAtOnce = exit.mock.calls.length;
			const ended = await child.exited;
			await until(() => exit.mock.calls.length > 0);
			const codes = exit.mock.calls.map(([exitCode]) => exitCode);
			exit.mockRestore();

			expect(exitedAtOnce).toBe(0);
			expect(ended).toEqual({ code: 0, signal: null });
			expect(child.lines).toEqual(["ready", "interrupted"]);
			expect(codes).toEqual([130]);
		});

		it("should give what a running child started the signal too", async () => {
			if (process.platform === "win32") return;
			const processes = new NativeProcessService(process.env, 5_000);
			lifecycleOf(processes);
			const child = start(
				processes,
				"const grandchild = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' }); console.log(grandchild.pid); setTimeout(() => {}, 60_000)"
			);
			await child.ready;
			const grandchild = Number(child.lines[0]);
			const exit = jest
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);

			process.emit("SIGINT");
			const ended = await child.exited;
			await until(() => exit.mock.calls.length > 0);
			const codes = exit.mock.calls.map(([exitCode]) => exitCode);
			exit.mockRestore();
			await until(() => !processes.isRunning(grandchild));

			expect(ended).toEqual({ code: null, signal: "SIGINT" });
			expect(codes).toEqual([130]);
			expect(processes.isRunning(grandchild)).toBe(false);
		});

		it("should kill a running child that ignores the signal after the grace period", async () => {
			if (process.platform === "win32") return;
			const processes = new NativeProcessService(process.env, 300);
			lifecycleOf(processes);
			const child = start(
				processes,
				"process.on('SIGINT', () => {}); console.log('ready'); setTimeout(() => {}, 60_000)"
			);
			await child.ready;
			const exit = jest
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);

			process.emit("SIGINT");
			await new Promise((resolve) => setTimeout(resolve, 150));
			const exitedWithinGrace = exit.mock.calls.length;
			const ended = await child.exited;
			await until(() => exit.mock.calls.length > 0);
			const codes = exit.mock.calls.map(([exitCode]) => exitCode);
			exit.mockRestore();

			expect(exitedWithinGrace).toBe(0);
			expect(ended).toEqual({ code: null, signal: "SIGKILL" });
			expect(codes).toEqual([130]);
		});

		it("should kill a running child at once on a second signal", async () => {
			if (process.platform === "win32") return;
			const processes = new NativeProcessService(process.env, 5_000);
			lifecycleOf(processes);
			const child = start(
				processes,
				"process.on('SIGINT', () => {}); console.log('ready'); setTimeout(() => {}, 60_000)"
			);
			await child.ready;
			const exit = jest
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);
			const write = jest
				.spyOn(process.stderr, "write")
				.mockImplementation(() => true);

			process.emit("SIGINT");
			await new Promise((resolve) => setTimeout(resolve, 100));
			process.emit("SIGINT");
			const codes = exit.mock.calls.map(([exitCode]) => exitCode);
			write.mockRestore();
			const ended = await child.exited;
			exit.mockRestore();

			expect(codes).toEqual([130]);
			expect(ended).toEqual({ code: null, signal: "SIGKILL" });
		});
	});
});
