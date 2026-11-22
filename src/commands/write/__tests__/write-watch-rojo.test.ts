import path from "path";
import { jest } from "@jest/globals";
import { harnessInstantiation } from "../../__tests__/command-harness.js";
import { DeferredPromise } from "../../../base/async.js";
import { DisposableStore } from "../../../base/disposable.js";
import { UsageError } from "../../../base/errors.js";
import { Emitter } from "../../../base/event.js";
import { Result, err, ok } from "../../../base/result.js";
import { ConfigSelection } from "../../../domain/config/config-service.js";
import { ResolvedConfig } from "../../../domain/config/resolved-config.js";
import { configServiceOf } from "../../../domain/config/__tests__/config-of.js";
import {
	RojoCommandRun,
	RojoCommandService,
	RojoWatch,
	RojoWatchExitEvent,
} from "../../../domain/runner/rojo-command-service.js";
import { RojoRestartEvent } from "../../../domain/runner/rojo-runner.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { RojoPlan, RojoStep } from "../rojo-step.js";
import { WriteWatch } from "../write-watch.js";

class FakeRojoWatch implements RojoWatch {
	readonly runs = new Emitter<RojoCommandRun>();
	readonly onDidRun = this.runs.event;
	readonly onDidRestart = new Emitter<RojoRestartEvent>().event;
	readonly onDidExit = new Emitter<RojoWatchExitEvent>().event;
	disposed = false;
	terminated = false;

	constructor(
		readonly project: string,
		private readonly ending: Promise<void> = Promise.resolve()
	) {}

	async terminate(): Promise<void> {
		await this.ending;
		this.terminated = true;
	}

	[Symbol.dispose](): void {
		this.disposed = true;
	}
}

class FakeRojoCommands implements RojoCommandService {
	declare readonly _serviceBrand: undefined;

	readonly watch =
		jest.fn<
			(
				selection: ConfigSelection,
				request: { readonly project?: ResolvedConfig }
			) => Promise<Result<RojoWatch, Error>>
		>();

	choose(selection: ConfigSelection): ResolvedConfig {
		return selection.configs[0];
	}

	run(): never {
		throw new Error("not watched");
	}

	runBare(): never {
		throw new Error("not watched");
	}
}

describe("WriteWatch with Rojo", () => {
	let memFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let logService: MockLogService;
	let rojo: FakeRojoCommands;
	let shutdown: AbortController;
	let store: DisposableStore;
	let chosen: string;
	let plans: Result<RojoPlan | undefined, UsageError>[];

	const settle = async () => {
		await jest.advanceTimersByTimeAsync(250);
		for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(0);
	};

	const step = (prints = false): RojoStep => ({
		command: "build",
		prints,
		target: { command: "build", cwd: "/repo", output: "game.rbxl" },
		plan: (selection) =>
			plans.shift() ??
			ok({
				project: selection.configs.find(
					({ file }) => path.basename(path.dirname(file)) === chosen
				)!,
				flags: [],
				cwd: "/repo",
			}),
	});

	const startWatch = async (rojoStep: RojoStep = step()) => {
		const instantiation = await harnessInstantiation({
			fs: memFs,
			log: logService,
			watcher,
			rojoCommands: rojo,
			config: configServiceOf(memFs, new MockEnvironmentService("/repo")),
		});
		const running = instantiation
			.createInstance(WriteWatch, ["a", "b"], false, rojoStep, "build")
			.run(store, shutdown.signal);
		await settle();
		return { running };
	};

	const startedOn = () =>
		rojo.watch.mock.calls.map(([, request]) => request.project?.file);

	const change = async (file: string) => {
		await memFs.writeFile(`/repo/src/${file}`, "");
		await settle();
	};

	beforeEach(async () => {
		jest.useFakeTimers();
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory("/repo/src");
		for (const folder of ["a", "b"])
			await memFs.writeFile(
				`/repo/${folder}/default.rogen.json`,
				JSON.stringify({
					sourcePaths: ["../src"],
					routes: { "*": "ReplicatedStorage" },
				})
			);
		watcher = new MemoryWatcher(memFs, new NullLogService());
		logService = new MockLogService();
		rojo = new FakeRojoCommands();
		shutdown = new AbortController();
		store = new DisposableStore();
		chosen = "a";
		plans = [];
	});

	afterEach(async () => {
		shutdown.abort();
		store[Symbol.dispose]();
		await watcher.stop();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	it("should end the Rojo it runs and start one on the new project when the project changes", async () => {
		const first = new FakeRojoWatch("a");
		const second = new FakeRojoWatch("b");
		rojo.watch
			.mockResolvedValueOnce(ok(first))
			.mockResolvedValueOnce(ok(second));
		await startWatch();

		chosen = "b";
		await change("A.luau");

		expect(startedOn()).toEqual([
			"/repo/a/default.rogen.json",
			"/repo/b/default.rogen.json",
		]);
		expect(first.terminated && first.disposed).toBe(true);
		expect(second.disposed).toBe(false);
	});

	it("should start no Rojo on the new project when it stops while the old one ends", async () => {
		const ending = new DeferredPromise<void>();
		rojo.watch.mockResolvedValueOnce(ok(new FakeRojoWatch("a", ending.p)));
		const { running } = await startWatch();

		chosen = "b";
		await change("A.luau");
		shutdown.abort();
		await settle();
		ending.complete();

		expect((await running).isOk()).toBe(true);
		expect(startedOn()).toHaveLength(1);
	});

	it("should end a Rojo that starts after it stopped", async () => {
		const started = new DeferredPromise<Result<RojoWatch, Error>>();
		const late = new FakeRojoWatch("a");
		rojo.watch.mockReturnValueOnce(started.p);
		const { running } = await startWatch();

		shutdown.abort();
		await settle();
		started.complete(ok(late));

		expect((await running).isOk()).toBe(true);
		expect(late.disposed).toBe(true);
		expect(logService.texts("error")).toEqual([]);
	});

	it("should not report a Rojo that fails to start after it stopped", async () => {
		const started = new DeferredPromise<Result<RojoWatch, Error>>();
		rojo.watch.mockReturnValueOnce(started.p);
		const { running } = await startWatch();

		shutdown.abort();
		await settle();
		started.complete(err(new Error("stopped before Rojo started")));

		expect((await running).isOk()).toBe(true);
		expect(logService.texts("error")).toEqual([]);
	});

	it("should report a Rojo that fails to start", async () => {
		rojo.watch.mockResolvedValueOnce(err(new Error("no rojo")));

		await startWatch();

		expect(logService.texts("error")).toEqual(["no rojo"]);
	});

	it("should report a start of Rojo that throws", async () => {
		rojo.watch.mockRejectedValueOnce(new Error("spawn failed"));

		await startWatch();

		expect(logService.texts("error")).toEqual(["spawn failed"]);
	});

	it("should report a plan for Rojo that fails after a change", async () => {
		rojo.watch.mockResolvedValue(ok(new FakeRojoWatch("a")));
		await startWatch();

		plans.push(err(new UsageError("no plan")));
		await change("A.luau");

		expect(logService.texts("error")).toEqual(["no plan"]);
	});

	it("should print only the lines Rojo printed to stdout", async () => {
		const watch = new FakeRojoWatch("a");
		rojo.watch.mockResolvedValueOnce(ok(watch));
		await startWatch(step(true));

		watch.runs.fire({
			project: rojo.watch.mock.calls[0][1].project!,
			messages: [
				{ severity: "unrecognised", text: "map", stdout: "map" },
				{ severity: "warning", text: "careful" },
			],
		});

		expect(logService.texts("print")).toEqual(["map"]);
	});
});
