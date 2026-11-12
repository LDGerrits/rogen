import { jest } from "@jest/globals";
import { setUnexpectedErrorHandler } from "../../../base/errors.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { rojoRunnerOf } from "./rojo-runner-fixtures.js";
import { RojoRestartEvent, SupervisedExitEvent } from "../rojo-runner.js";
import { ServerMessage } from "../rojo-server.js";
import { SupervisedRojo } from "../supervised-rojo.js";

const CRASH = [
	"[ERROR rojo] Rojo crashed! You are running Rojo 7.7.1.",
	"[ERROR rojo] This is probably a Rojo bug.",
	"[ERROR rojo] ",
	"[ERROR rojo] Details: called `Result::unwrap()` on an `Err` value",
	"[ERROR rojo] in file src/change_processor.rs on line 179",
	"note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace.",
]
	.map((line) => `${line}\n`)
	.join("");

const CRASH_LINES = [
	"Rojo crashed! You are running Rojo 7.7.1.",
	"This is probably a Rojo bug.",
	"Details: called `Result::unwrap()` on an `Err` value",
	"in file src/change_processor.rs on line 179",
];

describe("SupervisedRojo", () => {
	let processes: MockProcessService;
	let rewrites: number;
	let restarts: RojoRestartEvent[];
	let exits: SupervisedExitEvent[];
	let messages: ServerMessage[];
	let rojo: SupervisedRojo;

	const start = () => {
		const runner = rojoRunnerOf(new MemoryFileSystemService(), processes);
		rojo = new SupervisedRojo(
			() =>
				runner.start(
					{ file: "/bin/rojo", version: "7.7.1" },
					"serve",
					"default.project.json",
					[],
					"/repo"
				),
			{
				beforeRestart: async () => {
					rewrites++;
				},
			}
		);
		rojo.onDidRestart((restart) => restarts.push(restart));
		rojo.onDidExit((exit) => exits.push(exit));
		rojo.onDidMessage((message) => messages.push(message));
		return processes.spawned[0];
	};

	const crash = async (index: number) => {
		const child = processes.spawned[index];
		child.printError(CRASH);
		child.exit({ code: 1, signal: null });
		await jest.advanceTimersByTimeAsync(0);
	};

	beforeEach(() => {
		jest.useFakeTimers();
		processes = new MockProcessService();
		rewrites = 0;
		restarts = [];
		exits = [];
		messages = [];
	});

	afterEach(() => {
		rojo[Symbol.dispose]();
		jest.useRealTimers();
	});

	it("should rewrite and start Rojo again when it crashes while serving, and keep it", async () => {
		start();
		rojo.markReady();

		await crash(0);
		rojo.markReady();
		await jest.advanceTimersByTimeAsync(60_000);

		expect(rewrites).toBe(1);
		expect(processes.spawned).toHaveLength(2);
		expect(processes.spawned[1].args).toEqual(processes.spawned[0].args);
		expect(rojo.pid).toBe(processes.spawned[1].pid);
		expect(restarts).toEqual([
			{ exit: { code: 1, signal: null }, lines: CRASH_LINES },
		]);
		expect(exits).toEqual([]);
	});

	it("should pass on the crash as debug lines, not errors", async () => {
		start();
		rojo.markReady();

		await crash(0);

		expect(messages.filter(({ severity }) => severity !== "debug")).toEqual(
			[]
		);
		expect(messages.map(({ text }) => text)).toEqual(
			expect.arrayContaining(CRASH_LINES)
		);
	});

	it("should restart again when the restarted Rojo crashes soon after it serves again", async () => {
		start();
		rojo.markReady();
		await crash(0);
		rojo.markReady();

		await jest.advanceTimersByTimeAsync(6_000);
		await crash(1);
		await jest.advanceTimersByTimeAsync(500);
		rojo.markReady();
		await crash(2);
		await jest.advanceTimersByTimeAsync(1_000);

		expect(processes.spawned).toHaveLength(4);
		expect(restarts).toHaveLength(3);
		expect(exits).toEqual([]);
	});

	it("should wait longer before each back-to-back restart, doubling from half a second up to ten seconds", async () => {
		start();
		const waits: number[] = [];
		for (let index = 0; index < 8; index++) {
			rojo.markReady();
			await crash(index);
			let waited = 0;
			while (processes.spawned.length === index + 1) {
				await jest.advanceTimersByTimeAsync(100);
				waited += 100;
			}
			waits.push(waited);
		}

		expect(waits).toEqual([0, 500, 1000, 2000, 4000, 8000, 10000, 10000]);
	});

	it("should restart at once again after the restarted Rojo served for ten seconds", async () => {
		start();
		rojo.markReady();
		await crash(0);
		rojo.markReady();
		await crash(1);
		await jest.advanceTimersByTimeAsync(500);
		rojo.markReady();

		await jest.advanceTimersByTimeAsync(10_000);
		await crash(2);

		expect(processes.spawned).toHaveLength(4);
	});

	it("should start nothing when it is stopped while it waits to restart", async () => {
		start();
		rojo.markReady();
		await crash(0);
		rojo.markReady();
		await crash(1);

		await rojo.terminate();
		await jest.advanceTimersByTimeAsync(1_000);

		expect(processes.spawned).toHaveLength(2);
		expect(exits).toHaveLength(1);
	});

	it("should give up with Rojo's crash text when the restarted Rojo crashes before it serves", async () => {
		start();
		rojo.markReady();
		await crash(0);

		await jest.advanceTimersByTimeAsync(60_000);
		await crash(1);

		expect(processes.spawned).toHaveLength(2);
		expect(exits).toEqual([
			{ exit: { code: 1, signal: null }, gaveUp: CRASH_LINES },
		]);
	});

	it("should give as the crash text the errors Rojo printed when it printed no crash", async () => {
		start();
		rojo.markReady();
		await crash(0);

		processes.spawned[1].printError("[ERROR rojo] it broke\n");
		processes.spawned[1].exit({ code: 2, signal: null });
		await jest.advanceTimersByTimeAsync(0);

		expect(exits[0].gaveUp).toEqual(["it broke"]);
	});

	it("should not restart Rojo that turns out not to have served, and end as one that never did", async () => {
		start();
		rojo[Symbol.dispose]();
		rojo = new SupervisedRojo(
			() =>
				rojoRunnerOf(new MemoryFileSystemService(), processes).start(
					{ file: "/bin/rojo", version: "7.7.1" },
					"serve",
					undefined,
					[],
					"/repo"
				),
			{ confirmServed: async () => false }
		);
		rojo.onDidExit((exit) => exits.push(exit));
		rojo.markReady();

		await crash(1);

		expect(processes.spawned).toHaveLength(2);
		expect(exits).toEqual([{ exit: { code: 1, signal: null } }]);
	});

	it("should not take as serving a Rojo that has exited", async () => {
		start();

		await crash(0);

		expect(rojo.markReady()).toBe(false);
	});

	it("should not restart Rojo it was told to stop", async () => {
		start();
		rojo.markReady();

		await rojo.terminate();
		await jest.advanceTimersByTimeAsync(0);

		expect(processes.spawned).toHaveLength(1);
		expect(restarts).toEqual([]);
		expect(exits).toHaveLength(1);
		expect(exits[0].gaveUp).toBeUndefined();
	});

	it("should not restart Rojo that Ctrl+C stopped", async () => {
		start().exit({ code: 130, signal: null, interrupted: true });
		await jest.advanceTimersByTimeAsync(0);

		expect(processes.spawned).toHaveLength(1);
		expect(exits).toHaveLength(1);
	});

	it("should not restart Rojo that failed before it served, as when its port is taken", async () => {
		start();

		await crash(0);

		expect(processes.spawned).toHaveLength(1);
		expect(exits).toEqual([{ exit: { code: 1, signal: null } }]);
	});

	it("should not restart Rojo that exits cleanly or by a signal it was sent from elsewhere", async () => {
		start();
		rojo.markReady();

		processes.spawned[0].exit({ code: null, signal: "SIGKILL" });
		await jest.advanceTimersByTimeAsync(0);

		expect(processes.spawned).toHaveLength(1);
		expect(exits).toHaveLength(1);
	});

	it("should start nothing when it is stopped while it rewrites", async () => {
		start();
		rojo.markReady();
		let finish = () => {};
		const stalled = new Promise<void>((resolve) => {
			finish = resolve;
		});
		rojo[Symbol.dispose]();
		rojo = new SupervisedRojo(
			() =>
				rojoRunnerOf(new MemoryFileSystemService(), processes).start(
					{ file: "/bin/rojo", version: "7.7.1" },
					"serve",
					undefined,
					[],
					"/repo"
				),
			{ beforeRestart: () => stalled }
		);
		rojo.markReady();

		await crash(1);
		const stopped = rojo.terminate();
		finish();
		await stopped;
		await jest.advanceTimersByTimeAsync(0);

		expect(processes.spawned).toHaveLength(2);
	});

	it("should end as a failed exit, and report the error, when its restart throws", async () => {
		const reported: Error[] = [];
		const restore = setUnexpectedErrorHandler((error) => {
			reported.push(error);
		});
		const broken = new Error("The project file can't be written.");
		try {
			rojo = new SupervisedRojo(
				() =>
					rojoRunnerOf(
						new MemoryFileSystemService(),
						processes
					).start(
						{ file: "/bin/rojo", version: "7.7.1" },
						"serve",
						undefined,
						[],
						"/repo"
					),
				{
					beforeRestart: async () => {
						throw broken;
					},
				}
			);
			rojo.onDidExit((exit) => exits.push(exit));
			rojo.markReady();

			await crash(0);

			expect(processes.spawned).toHaveLength(1);
			expect(exits).toEqual([{ exit: { code: 1, signal: null } }]);
			expect(reported).toEqual([broken]);
		} finally {
			setUnexpectedErrorHandler(restore);
		}
	});
});
