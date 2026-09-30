import "../../config/config-schema.js";
import { jest } from "@jest/globals";
import { DisposableStore } from "../../../base/disposable.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { NullLogService } from "../../../platform/log/log-service.js";
import { CoreReconciliationService } from "../../../platform/watcher/core-reconciliation-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { WatchSession, WatchUpdate } from "../watch-session.js";
import { buildServiceOf } from "../../build/__tests__/fixtures.js";

describe("WatchSession", () => {
	let fs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let configService: CoreConfigService;
	let store: DisposableStore;
	let updates: WatchUpdate[];
	let errors: Error[];

	const settle = async () => {
		await jest.advanceTimersByTimeAsync(150);
		for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(0);
	};

	const writeConfig = (file: string, body: Record<string, unknown>) =>
		fs.writeFile(
			file,
			JSON.stringify({
				rootDirs: ["src"],
				routes: { "*": "ReplicatedStorage" },
				...body,
			})
		);

	const start = async (names: string[] = []) => {
		await configService.initialize({ names, paths: [] });
		const indexService = store.add(new CoreIndexService(fs));
		const session = store.add(
			new WatchSession(
				watcher,
				store.add(
					new CoreReconciliationService(new NullLogService(), {
						burstThreshold: 200,
						debounceMs: 100,
					})
				),
				configService,
				indexService,
				buildServiceOf(fs, indexService)
			)
		);
		store.add(session.onDidUpdate((update) => updates.push(update)));
		store.add(session.onDidError((error) => errors.push(error)));
		await session.start();
		await settle();
		return session;
	};

	beforeEach(async () => {
		jest.useFakeTimers();
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo/src");
		watcher = new MemoryWatcher(fs, new NullLogService());
		configService = new CoreConfigService(
			fs,
			new MockEnvironmentService(undefined, "/repo")
		);
		store = new DisposableStore();
		updates = [];
		errors = [];
		await writeConfig("/repo/default.rogen.json", {});
	});

	afterEach(async () => {
		await watcher.stop();
		store[Symbol.dispose]();
		configService[Symbol.dispose]();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	it("should build every config once it starts, as one initial update", async () => {
		await fs.writeFile("/repo/src/A.luau", "");

		await start();

		expect(updates).toHaveLength(1);
		expect(updates[0].cause).toEqual({ kind: "initial" });
		expect(updates[0].reports).toMatchObject([
			{ outcome: "wrote", config: { file: "/repo/default.rogen.json" } },
		]);
		expect(updates[0].reports[0].summary?.roots[0].files).toBe(1);
		expect(await fs.exists("/repo/default.project.json")).toBe(true);
	});

	it("should rebuild only the configs whose root dirs hold a change", async () => {
		await fs.createDirectory("/repo/lobby");
		await writeConfig("/repo/lobby.rogen.json", { rootDirs: ["lobby"] });
		await start(["default", "lobby"]);

		await fs.writeFile("/repo/lobby/B.luau", "");
		await settle();

		expect(updates).toHaveLength(2);
		expect(updates[1].cause).toEqual({
			kind: "change",
			sourceFiles: 1,
			configFiles: [],
			reloaded: false,
		});
		expect(updates[1].changes.map(({ path }) => path)).toEqual([
			"/repo/lobby/B.luau",
		]);
		expect(updates[1].reports.map(({ config }) => config.file)).toEqual([
			"/repo/lobby.rogen.json",
		]);
	});

	it("should report a broken config and keep the last valid one, with nothing to rebuild", async () => {
		await start();

		await fs.writeFile("/repo/default.rogen.json", "{ broken");
		await settle();

		expect(updates[1].cause).toMatchObject({
			kind: "change",
			configFiles: ["/repo/default.rogen.json"],
		});
		const [notice] = updates[1].notices;
		expect(notice.file).toBe("/repo/default.rogen.json");
		expect(new Set(notice.errors.map(({ code }) => code))).toEqual(
			new Set(["config.invalidSyntax"])
		);
		expect(updates[1].reports).toEqual([]);
		expect(configService.configs[0].resolved).toBeDefined();
	});

	it("should report every diagnostic of a rebuild, new or not", async () => {
		await fs.writeFile("/repo/src/Hud.meta.json", "{}");
		await start();

		await fs.writeFile("/repo/src/A.luau", "");
		await settle();

		for (const update of updates.slice(0, 2)) {
			expect(update.reports[0].diagnostics).toMatchObject([
				{ code: "meta.unclaimed" },
			]);
		}
	});

	it("should report the sync dir check only for a round that made it", async () => {
		await start();

		await fs.writeFile("/repo/src/A.luau", "");
		await settle();

		expect(updates[0].reports[0].syncDiagnostics).toEqual([]);
		expect(updates[1].reports[0].syncDiagnostics).toBeUndefined();
	});

	it("should not rebuild for an update to a meta file the build never read", async () => {
		await fs.writeFile("/repo/src/Hud.luau", "");
		await fs.writeFile("/repo/src/Hud.meta.json", "{}");
		await start();

		await fs.writeFile("/repo/src/Hud.meta.json", '{"className":"Actor"}');
		await settle();

		expect(updates).toHaveLength(1);
	});

	it("should not rebuild for an update to a source file, only for a new one", async () => {
		await fs.writeFile("/repo/src/A.luau", "");
		await start();

		await fs.writeFile("/repo/src/A.luau", "return 1");
		await settle();
		expect(updates).toHaveLength(1);

		await fs.writeFile("/repo/src/B.luau", "");
		await settle();
		expect(updates).toHaveLength(2);
	});

	it("should rebuild for an update to a folder's init.meta.json, which the build reads", async () => {
		await fs.createDirectory("/repo/src/Combat");
		await fs.writeFile("/repo/src/Combat/Hit.luau", "");
		await fs.writeFile("/repo/src/Combat/init.meta.json", "{}");
		await start();

		await fs.writeFile(
			"/repo/src/Combat/init.meta.json",
			'{"className":"Actor"}'
		);
		await settle();

		expect(updates).toHaveLength(2);
	});

	it("should rebuild for the fix to a folder meta that made the build fail", async () => {
		await fs.createDirectory("/repo/src/Combat");
		await fs.writeFile("/repo/src/Combat/Hit.luau", "");
		await fs.writeFile("/repo/src/Combat/init.meta.json", "{ broken");
		await start();
		expect(updates[0].reports[0].outcome).toBe("failed");

		await fs.writeFile("/repo/src/Combat/init.meta.json", "{}");
		await settle();

		expect(updates).toHaveLength(2);
		expect(updates[1].reports[0].outcome).toBe("wrote");
	});

	it("should report a config with no problems, so a fixed one is forgotten", async () => {
		await start();
		await fs.writeFile("/repo/default.rogen.json", "{ broken");
		await settle();
		await writeConfig("/repo/default.rogen.json", {});
		await settle();

		const notice = updates[updates.length - 1].notices[0];
		expect(notice.file).toBe("/repo/default.rogen.json");
		expect(notice.errors).toEqual([]);
	});

	it("should run nothing new once it stops, and stop the watcher", async () => {
		const session = await start();
		const stop = jest.spyOn(watcher, "stop");

		await session.stop();
		await fs.writeFile("/repo/src/A.luau", "");
		await settle();

		expect(stop).toHaveBeenCalledTimes(1);
		expect(updates).toHaveLength(1);
		expect(errors).toEqual([]);
	});
});
