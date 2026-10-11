import { jest } from "@jest/globals";
import { DeferredPromise } from "../../../base/async.js";
import { DisposableStore } from "../../../base/disposable.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import {
	ReloadableSelection,
	buildableConfig,
} from "../../config/config-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { BuildSet, OutputFile } from "../../build/build.js";
import { WatchUpdate } from "../watch-service.js";
import { CoreWatchSession } from "../core-watch-session.js";
import { buildServiceOf } from "../../build/__tests__/fixtures.js";

const isDefaultStaging = (file: string): boolean =>
	new OutputFile("/repo/default.project.json").stagingPattern.test(file);

describe("CoreWatchSession", () => {
	let fs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let configService: CoreConfigService;
	let selection: ReloadableSelection;
	let store: DisposableStore;
	let updates: WatchUpdate[];
	let errors: Error[];

	const settle = async () => {
		await jest.advanceTimersByTimeAsync(250);
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

	const write = (file: string, body: Record<string, unknown> | string) =>
		fs.writeFile(
			file,
			typeof body === "string" ? body : JSON.stringify(body)
		);

	const config = (extra: Record<string, unknown> = {}) => ({
		rootDirs: ["src"],
		routes: { "*": "ReplicatedStorage" },
		...extra,
	});

	const built = async (name: string): Promise<string[]> => {
		const project = JSON.parse(
			await fs.readFile(`/repo/${name}.project.json`)
		);
		return Object.keys(project.tree.ReplicatedStorage ?? {}).filter(
			(key) => !key.startsWith("$")
		);
	};

	const changeUpdates = () =>
		updates.filter(({ cause }) => cause.kind === "change");

	const start = async (names: string[] = ["default"]) => {
		selection = (await configService.select(names, {})).unwrap();
		const indexService = new CoreIndexService(fs);
		const session = store.add(
			new CoreWatchSession(
				selection,
				BuildSet.of(selection).unwrap(),
				watcher,
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
			new MockEnvironmentService("/repo")
		);
		store = new DisposableStore();
		updates = [];
		errors = [];
		await writeConfig("/repo/default.rogen.json", {});
	});

	afterEach(async () => {
		jest.restoreAllMocks();
		await watcher.stop();
		store[Symbol.dispose]();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	it("should build every config once it starts, as one initial update", async () => {
		await fs.writeFile("/repo/src/A.luau", "");

		await start();

		expect(updates).toHaveLength(1);
		expect(updates[0].cause).toEqual({ kind: "initial" });
		expect(updates[0].reports).toMatchObject([
			{
				build: {
					outcome: "wrote",
					config: { file: "/repo/default.rogen.json" },
				},
			},
		]);
		expect(updates[0].reports[0].build).toMatchObject({
			summary: { roots: [{ files: 1 }] },
		});
		expect(await fs.exists("/repo/default.project.json")).toBe(true);
	});

	it("should refuse to start twice, which would report every update twice", async () => {
		const session = await start();

		await expect(session.start()).rejects.toThrow("A watch starts once.");
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
		expect(
			updates[1].reports.map(({ build }) => build.config.file)
		).toEqual(["/repo/lobby.rogen.json"]);
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
		expect(notice).toMatchObject({
			kind: "broken",
			file: "/repo/default.rogen.json",
		});
		expect(
			notice.kind === "broken" &&
				new Set(notice.errors.map(({ code }) => code))
		).toEqual(new Set(["config.invalidSyntax"]));
		expect(updates[1].reports).toEqual([]);
		expect(buildableConfig(selection.entries[0])).toBeDefined();
	});

	it("should report every diagnostic of a rebuild, new or not", async () => {
		await fs.writeFile("/repo/src/Hud.meta.json", "{}");
		await start();

		await fs.writeFile("/repo/src/A.luau", "");
		await settle();

		for (const update of updates.slice(0, 2)) {
			expect(update.reports[0].build.warnings).toMatchObject([
				{ code: "meta.unclaimed" },
			]);
		}
	});

	it("should warn about a link to its own parent added while watching, as a fresh build does", async () => {
		await fs.writeFile("/repo/src/A.luau", "");
		await start();

		await fs.createSymbolicLink("/repo/src", "/repo/src/Loop");
		await settle();

		expect(updates.at(-1)?.reports[0].build.warnings).toMatchObject([
			{ code: "scan.unresolvedLink" },
		]);
		expect(updates.at(-1)?.reports[0].build).toMatchObject({
			summary: { roots: [{ files: 1 }] },
		});
	});

	it("should report a diagnostic once while it persists, and again after it went away", async () => {
		await fs.writeFile("/repo/src/Hud.meta.json", "{}");
		await start();
		const unreported = () =>
			updates.at(-1)?.reports[0].unreported.map(({ code }) => code);

		await fs.writeFile("/repo/src/A.luau", "");
		await settle();
		expect(unreported()).toEqual([]);

		await fs.delete("/repo/src/Hud.meta.json");
		await settle();
		await fs.writeFile("/repo/src/Hud.meta.json", "{}");
		await settle();
		expect(unreported()).toEqual(["meta.unclaimed"]);
	});

	it("should hand over the diagnostics it leaves out as repeated, so the count agrees with what was printed", async () => {
		await fs.writeFile("/repo/src/Hud.meta.json", "{}");
		await start();
		const codes = (list: readonly { code: string }[] | undefined) =>
			list?.map(({ code }) => code);

		expect(codes(updates[0].reports[0].repeated)).toEqual([]);
		expect(codes(updates[0].reports[0].unreported)).toEqual([
			"meta.unclaimed",
		]);

		await fs.writeFile("/repo/src/A.luau", "");
		await settle();

		const report = updates.at(-1)?.reports[0];
		expect(codes(report?.unreported)).toEqual([]);
		expect(codes(report?.repeated)).toEqual(["meta.unclaimed"]);
	});

	it("should hand over a diagnostic that went away as fixed, once", async () => {
		await fs.writeFile("/repo/src/Hud.meta.json", "{}");
		await start();
		const codes = (list: readonly { code: string }[] | undefined) =>
			list?.map(({ code }) => code);
		expect(codes(updates[0].reports[0].fixed)).toEqual([]);

		await fs.delete("/repo/src/Hud.meta.json");
		await settle();
		expect(codes(updates.at(-1)?.reports[0].fixed)).toEqual([
			"meta.unclaimed",
		]);

		await fs.writeFile("/repo/src/A.luau", "");
		await settle();
		expect(codes(updates.at(-1)?.reports[0].fixed)).toEqual([]);
	});

	describe("watching every config here", () => {
		it("should build a config added while watching, and say so", async () => {
			await fs.writeFile("/repo/src/A.luau", "");
			await start([]);

			await writeConfig("/repo/lobby.rogen.json", {});
			await settle();

			const update = changeUpdates().at(-1);
			expect(update?.notices).toEqual([
				{ kind: "added", file: "/repo/lobby.rogen.json" },
			]);
			expect(
				update?.reports.map(({ build }) => build.config.file)
			).toContain("/repo/lobby.rogen.json");
			expect(await built("lobby")).toEqual(["A"]);
		});

		it("should rebuild an added config when its sources change", async () => {
			await start([]);
			await writeConfig("/repo/lobby.rogen.json", { rootDirs: ["more"] });
			await fs.createDirectory("/repo/more");
			await settle();

			await fs.writeFile("/repo/more/B.luau", "");
			await settle();

			expect(await built("lobby")).toEqual(["B"]);
		});

		it("should stop building a config deleted while watching, and say so", async () => {
			await writeConfig("/repo/lobby.rogen.json", {});
			await start([]);

			await fs.delete("/repo/lobby.rogen.json");
			await settle();
			const before = updates.length;
			await fs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(changeUpdates()[0].notices).toEqual([
				{ kind: "removed", file: "/repo/lobby.rogen.json" },
			]);
			expect(
				updates
					.slice(before)
					.flatMap(({ reports }) =>
						reports.map(({ build }) => build.config.file)
					)
			).toEqual(["/repo/default.rogen.json"]);
		});

		it("should report a config added broken without building it", async () => {
			await start([]);

			await write("/repo/lobby.rogen.json", "{ broken");
			await settle();

			const update = changeUpdates().at(-1);
			expect(update?.notices).toMatchObject([
				{ kind: "broken", keptLastValid: false },
			]);
			expect(
				update?.reports.map(({ build }) => build.config.file)
			).not.toContain("/repo/lobby.rogen.json");
		});

		it("should not look for configs when the run named them", async () => {
			await start(["default"]);

			await writeConfig("/repo/lobby.rogen.json", {});
			await settle();

			expect(changeUpdates()).toEqual([]);
		});

		it("should ignore other files added to the folder", async () => {
			await start([]);

			await fs.writeFile("/repo/README.md", "");
			await settle();

			expect(changeUpdates()).toEqual([]);
		});
	});

	it("should not call a warning fixed because the build that followed it failed", async () => {
		await fs.writeFile("/repo/src/Hud.meta.json", "{}");
		await start();

		await fs.writeFile("/repo/src/init.luau", "");
		await settle();

		expect(updates.at(-1)?.reports[0].build.outcome).toBe("failed");
		expect(updates.at(-1)?.reports[0].fixed).toEqual([]);
	});

	it("should check the sync dir when the config loads, and not again until it changes", async () => {
		await writeConfig("/repo/default.rogen.json", { syncDir: "dist" });
		await fs.writeFile("/repo/src/A.luau", "");
		await start();

		await fs.writeFile("/repo/src/B.luau", "");
		await settle();

		expect(updates[0].reports[0].unreported).toMatchObject([
			{ code: "output.nothingEmitted" },
		]);
		expect(updates[1].reports[0].unreported).toEqual([]);
		expect(updates[1].reports[0].build.syncWarnings).toBe(
			updates[0].reports[0].build.syncWarnings
		);
	});

	it("should not rebuild for an update to a meta file the build never read", async () => {
		await fs.writeFile("/repo/src/Notes.txt", "");
		await fs.writeFile("/repo/src/Notes.meta.json", "{}");
		await start();

		await fs.writeFile(
			"/repo/src/Notes.meta.json",
			'{"attributes":{"a":1}}'
		);
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
		expect(updates[0].reports[0].build.outcome).toBe("failed");

		await fs.writeFile("/repo/src/Combat/init.meta.json", "{}");
		await settle();

		expect(updates).toHaveLength(2);
		expect(updates[1].reports[0].build.outcome).toBe("wrote");
	});

	it("should report a config's errors again once it breaks again after a fix", async () => {
		await start();
		await fs.writeFile("/repo/default.rogen.json", "{ broken");
		await settle();
		await writeConfig("/repo/default.rogen.json", {});
		await settle();
		await fs.writeFile("/repo/default.rogen.json", "{ broken");
		await settle();

		const notices = updates.flatMap((update) => update.notices);
		expect(notices.map(({ kind }) => kind)).toEqual([
			"broken",
			"recovered",
			"broken",
		]);
		expect(notices[2]).toEqual(notices[0]);
	});

	it("should say a broken config loads again when the fix restores what last built", async () => {
		await start();
		await fs.writeFile("/repo/default.rogen.json", "{ broken");
		await settle();

		await writeConfig("/repo/default.rogen.json", {});
		await settle();

		expect(updates.at(-1)?.notices).toEqual([
			{ kind: "recovered", file: "/repo/default.rogen.json" },
		]);
	});

	it("should not report a config's errors again while it stays broken the same way", async () => {
		await start();
		await fs.writeFile("/repo/default.rogen.json", "{ broken");
		await settle();
		await fs.writeFile("/repo/default.rogen.json", "{ broken");
		await settle();

		expect(updates.flatMap((update) => update.notices)).toHaveLength(1);
	});

	describe("a reload that makes two configs write one file", () => {
		const clash = async () => {
			await fs.createDirectory("/repo/lobby");
			await fs.writeFile("/repo/src/A.luau", "");
			await fs.writeFile("/repo/lobby/B.luau", "");
			await writeConfig("/repo/lobby.rogen.json", {
				rootDirs: ["lobby"],
			});
			await start(["default", "lobby"]);
		};
		const lastReports = () =>
			Object.fromEntries(
				updates[updates.length - 1].reports.map(({ build }) => [
					build.config.file,
					build,
				])
			);

		it("should fail both configs with the error and write neither", async () => {
			await clash();
			const before = await fs.readFile("/repo/default.project.json");

			await writeConfig("/repo/lobby.rogen.json", {
				rootDirs: ["lobby"],
				outFile: "default.project.json",
			});
			await settle();

			const reports = lastReports();
			for (const file of [
				"/repo/default.rogen.json",
				"/repo/lobby.rogen.json",
			]) {
				expect(reports[file]).toMatchObject({
					outcome: "failed",
					errors: [{ code: "output.sameOutFile" }],
				});
			}
			expect(await fs.readFile("/repo/default.project.json")).toBe(
				before
			);
			expect(errors).toEqual([]);
		});

		it("should keep both failed on a source change while the clash stands", async () => {
			await clash();
			await writeConfig("/repo/lobby.rogen.json", {
				rootDirs: ["lobby"],
				outFile: "default.project.json",
			});
			await settle();
			const before = await fs.readFile("/repo/default.project.json");

			await fs.writeFile("/repo/lobby/C.luau", "");
			await settle();

			expect(lastReports()["/repo/lobby.rogen.json"].outcome).toBe(
				"failed"
			);
			expect(await fs.readFile("/repo/default.project.json")).toBe(
				before
			);
		});

		it("should check the sync dir of a config again once its clash is fixed", async () => {
			await writeConfig("/repo/default.rogen.json", { syncDir: "dist" });
			await clash();
			await writeConfig("/repo/lobby.rogen.json", {
				rootDirs: ["lobby"],
				outFile: "default.project.json",
			});
			await settle();

			await writeConfig("/repo/lobby.rogen.json", {
				rootDirs: ["lobby"],
			});
			await settle();

			expect(
				lastReports()["/repo/default.rogen.json"].syncWarnings
			).toMatchObject([{ code: "output.nothingEmitted" }]);
		});

		it("should build both again once the clash is fixed", async () => {
			await clash();
			await writeConfig("/repo/lobby.rogen.json", {
				rootDirs: ["lobby"],
				outFile: "default.project.json",
			});
			await settle();

			await writeConfig("/repo/lobby.rogen.json", {
				rootDirs: ["lobby"],
			});
			await settle();

			const reports = lastReports();
			expect(
				Object.values(reports).map(({ outcome }) => outcome)
			).toEqual(["unchanged", "unchanged"]);
			expect(Object.keys(reports).sort()).toEqual([
				"/repo/default.rogen.json",
				"/repo/lobby.rogen.json",
			]);
		});
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
	describe("watching", () => {
		const rootsOf = (paths: readonly string[]) =>
			paths.filter((watched) => !watched.endsWith(".rogen.json"));

		it("should watch two configs that share a root through one watcher call and one directory", async () => {
			await write("/repo/source.rogen.json", config());
			const watch = jest.spyOn(watcher, "watch");

			await start(["default", "source"]);

			expect(watch).toHaveBeenCalledTimes(1);
			const [paths] = watch.mock.calls[0];
			expect(rootsOf(paths)).toEqual(["/repo/src"]);
		});

		it("should answer with the failure when the watcher can't start", async () => {
			jest.spyOn(watcher, "watch").mockRejectedValue(new Error("boom"));
			selection = (await configService.select(["default"], {})).unwrap();
			const indexService = new CoreIndexService(fs);
			const session = store.add(
				new CoreWatchSession(
					selection,
					BuildSet.of(selection).unwrap(),
					watcher,
					indexService,
					buildServiceOf(fs, indexService)
				)
			);

			const started = await session.start();

			expect(started.isErr() && started.error.message).toBe("boom");
		});

		it("should drop a root that lies inside another", async () => {
			await write(
				"/repo/lobby.rogen.json",
				config({ rootDirs: ["src/shared"] })
			);
			const watch = jest.spyOn(watcher, "watch");

			await start(["default", "lobby"]);

			const [paths] = watch.mock.calls[0];
			expect(rootsOf(paths)).toEqual(["/repo/src"]);
		});

		it("should not watch the parent that two roots share", async () => {
			await write(
				"/repo/default.rogen.json",
				config({ rootDirs: ["places/a", "places/b"] })
			);
			const watch = jest.spyOn(watcher, "watch");

			await start();

			const [paths] = watch.mock.calls[0];
			expect(rootsOf(paths)).toEqual([
				"/repo/places/a",
				"/repo/places/b",
			]);
		});

		it("should tell the watcher to skip each output file and sync directory", async () => {
			await write("/repo/default.rogen.json", config({ syncDir: "out" }));
			const watch = jest.spyOn(watcher, "watch");

			await start();

			const [, options] = watch.mock.calls[0];
			expect(options?.ignored).toEqual([
				"/repo/default.project.json",
				"/repo/out",
				new OutputFile("/repo/default.project.json").stagingPattern,
			]);
		});

		it("should emit one batch for one change to a root shared by two configs", async () => {
			await write("/repo/source.rogen.json", config());
			await start(["default", "source"]);

			await fs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(changeUpdates()).toHaveLength(1);
		});

		it("should not rebuild off its own write to a watched root", async () => {
			await write(
				"/repo/default.rogen.json",
				config({ outFile: "src/out.project.json" })
			);
			await start();

			await fs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(changeUpdates()).toHaveLength(1);
			expect(changeUpdates()[0].changes.map((c) => c.path)).toEqual([
				"/repo/src/A.luau",
			]);
		});
	});

	describe("source changes", () => {
		it("should add a new source file to the project file", async () => {
			await start();

			await fs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(await built("default")).toEqual(["A"]);
		});

		it("should drop the removal of a source file from the project file", async () => {
			await fs.writeFile("/repo/src/A.luau", "");
			await start();

			await fs.delete("/repo/src/A.luau");
			await settle();

			expect(await built("default")).toEqual([]);
		});

		it("should not queue an update to a source file", async () => {
			await fs.writeFile("/repo/src/A.luau", "");
			await start();

			await fs.writeFile("/repo/src/A.luau", "-- edited");
			await settle();

			expect(changeUpdates()).toEqual([]);
		});

		it("should rebuild when a folder's meta changes, and keep the last output while it is invalid", async () => {
			await write(
				"/repo/default.rogen.json",
				config({ routes: { server: "ServerScriptService" } })
			);
			await fs.writeFile("/repo/src/Combat/server/Hit.luau", "");
			await write("/repo/src/Combat/init.meta.json", {
				className: "Actor",
			});
			const combatClass = async () =>
				JSON.parse(await fs.readFile("/repo/default.project.json")).tree
					.ServerScriptService.Combat.$className;
			await start();
			expect(await combatClass()).toBe("Actor");

			await write("/repo/src/Combat/init.meta.json", {
				className: "Configuration",
			});
			await settle();
			expect(await combatClass()).toBe("Configuration");

			await write("/repo/src/Combat/init.meta.json", "{ broken");
			await settle();
			expect(await combatClass()).toBe("Configuration");
			expect(updates.at(-1)?.reports[0].build.outcome).toBe("failed");
		});

		it("should reach every config that claims the path, each once", async () => {
			await write("/repo/source.rogen.json", config());
			await start(["default", "source"]);
			const rename = jest.spyOn(fs, "rename");

			await fs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(await built("default")).toEqual(["A"]);
			expect(await built("source")).toEqual(["A"]);
			expect(rename.mock.calls.map(([, to]) => to).sort()).toEqual([
				"/repo/default.project.json",
				"/repo/source.project.json",
			]);
		});

		it("should reach only the configs whose roots contain the path", async () => {
			await fs.createDirectory("/repo/lib");
			await write(
				"/repo/lobby.rogen.json",
				config({ rootDirs: ["lib"] })
			);
			await start(["default", "lobby"]);
			const rename = jest.spyOn(fs, "rename");

			await fs.writeFile("/repo/lib/B.luau", "");
			await settle();

			expect(rename.mock.calls.map(([, to]) => to)).toEqual([
				"/repo/lobby.project.json",
			]);
		});

		it("should not rewrite a project file whose bytes would not change", async () => {
			await start();
			const rename = jest.spyOn(fs, "rename");
			const readFile = jest.spyOn(fs, "readFile");

			await write(
				"/repo/default.rogen.json",
				config({ variants: ["mock"] })
			);
			await settle();

			expect(readFile).toHaveBeenCalledWith("/repo/default.project.json");
			expect(rename).not.toHaveBeenCalled();
		});

		it("should rebuild one config while another is still writing", async () => {
			await write("/repo/source.rogen.json", config());
			await start(["default", "source"]);
			const gate = new DeferredPromise<void>();
			const writeFile = fs.writeFile.bind(fs);
			jest.spyOn(fs, "writeFile").mockImplementation(
				async (file, content) => {
					if (isDefaultStaging(file)) await gate.p;
					return writeFile(file, content);
				}
			);

			await fs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(await built("source")).toEqual(["A"]);
			expect(await built("default")).toEqual([]);

			gate.complete();
			await settle();

			expect(await built("default")).toEqual(["A"]);
		});

		it("should not overlap two rebuilds of one config", async () => {
			await start();
			const gate = new DeferredPromise<void>();
			const writeFile = fs.writeFile.bind(fs);
			const staged = jest.fn();
			jest.spyOn(fs, "writeFile").mockImplementation(
				async (file, content) => {
					if (isDefaultStaging(file)) {
						staged();
						await gate.p;
					}
					return writeFile(file, content);
				}
			);

			await fs.writeFile("/repo/src/A.luau", "");
			await settle();
			await fs.writeFile("/repo/src/B.luau", "");
			await settle();

			expect(staged).toHaveBeenCalledTimes(1);

			gate.complete();
			await settle();

			expect(staged).toHaveBeenCalledTimes(2);
			expect(await built("default")).toEqual(["A", "B"]);
		});
	});

	describe("linked directories", () => {
		const outFile = () => fs.readFile("/repo/default.project.json");

		it("should add a linked directory to the project file", async () => {
			await fs.writeFile("/shared/Util.luau", "");
			await start();

			await fs.createSymbolicLink("/shared", "/repo/src/Shared");
			await settle();

			expect(await built("default")).toEqual(["Shared"]);
		});

		it("should drop a removed link from the project file", async () => {
			await fs.writeFile("/shared/Util.luau", "");
			await fs.createSymbolicLink("/shared", "/repo/src/Shared");
			await start();
			expect(await built("default")).toEqual(["Shared"]);

			await fs.delete("/repo/src/Shared", true);
			await settle();

			expect(await built("default")).toEqual([]);
			expect(await fs.exists("/shared/Util.luau")).toBe(true);
		});

		it("should rebuild when a file is added inside a target outside every root dir", async () => {
			await write(
				"/repo/default.rogen.json",
				config({
					routes: {
						server: "ServerScriptService",
						"*": "ReplicatedStorage",
					},
				})
			);
			await fs.writeFile("/shared/Util.luau", "");
			await fs.createSymbolicLink("/shared", "/repo/src/Shared");
			await start();
			expect(await outFile()).not.toContain("ServerScriptService");

			await fs.writeFile("/shared/Save.server.luau", "");
			await settle();

			expect(await outFile()).toContain("ServerScriptService");
		});

		it("should rebuild when a file is removed inside a target outside every root dir", async () => {
			await write(
				"/repo/default.rogen.json",
				config({
					routes: {
						server: "ServerScriptService",
						"*": "ReplicatedStorage",
					},
				})
			);
			await fs.writeFile("/shared/Save.server.luau", "");
			await fs.createSymbolicLink("/shared", "/repo/src/Shared");
			await start();
			expect(await outFile()).toContain("ServerScriptService");

			await fs.delete("/shared/Save.server.luau");
			await settle();

			expect(await outFile()).not.toContain("ServerScriptService");
		});
	});

	describe("hot reload", () => {
		it("should reload when a config changes", async () => {
			await start();
			const reload = jest.spyOn(selection, "reload");

			await write(
				"/repo/default.rogen.json",
				config({ rootDirs: ["src"], exclude: [] })
			);
			await settle();

			expect(reload).toHaveBeenCalledWith(["/repo/default.rogen.json"]);
		});

		it("should reload when a template changes", async () => {
			await write("/repo/template.project.json", {
				name: "one",
				tree: {},
			});
			await write(
				"/repo/default.rogen.json",
				config({ template: "template.project.json" })
			);
			await start();
			const reload = jest.spyOn(selection, "reload");

			await write("/repo/template.project.json", {
				name: "two",
				tree: {},
			});
			await settle();

			expect(reload).toHaveBeenCalledWith([
				"/repo/template.project.json",
			]);
			expect(
				JSON.parse(await fs.readFile("/repo/default.project.json")).name
			).toBe("two");
		});

		it("should not reload when an unrelated config changes", async () => {
			await write("/repo/other.rogen.json", config());
			await start();
			const reload = jest.spyOn(selection, "reload");

			await write("/repo/other.rogen.json", config({ exclude: ["x"] }));
			await settle();

			expect(reload).not.toHaveBeenCalled();
		});

		it("should reload every config that extends an edited parent", async () => {
			await write("/repo/base.rogen.json", config());
			await write("/repo/default.rogen.json", {
				extends: "base.rogen.json",
			});
			await write("/repo/source.rogen.json", {
				extends: "base.rogen.json",
				outFile: "source.project.json",
			});
			await fs.createDirectory("/repo/lib");
			await fs.writeFile("/repo/lib/L.luau", "");
			await start(["default", "source"]);

			await write("/repo/base.rogen.json", config({ rootDirs: ["lib"] }));
			await settle();

			expect(await built("default")).toEqual(["L"]);
			expect(await built("source")).toEqual(["L"]);
		});

		it("should watch again when a reload adds a root", async () => {
			await fs.createDirectory("/repo/lib");
			await start();
			const watch = jest.spyOn(watcher, "watch");

			await write(
				"/repo/default.rogen.json",
				config({ rootDirs: ["lib"] })
			);
			await settle();
			await fs.writeFile("/repo/lib/L.luau", "");
			await settle();

			expect(watch).toHaveBeenCalledTimes(1);
			expect(await built("default")).toEqual(["L"]);
		});

		it("should pick up a config edited while the watcher restarted", async () => {
			await fs.createDirectory("/repo/lib");
			await fs.createDirectory("/repo/lib2");
			await fs.writeFile("/repo/lib2/L2.luau", "");
			await start();
			const watch = watcher.watch.bind(watcher);
			jest.spyOn(watcher, "watch").mockImplementationOnce(
				async (requests, options) => {
					await write(
						"/repo/default.rogen.json",
						config({ rootDirs: ["lib2"] })
					);
					return watch(requests, options);
				}
			);

			await write(
				"/repo/default.rogen.json",
				config({ rootDirs: ["lib"] })
			);
			await settle();

			expect(await built("default")).toEqual(["L2"]);
		});

		it("should keep building from the last valid config when one goes invalid", async () => {
			await write("/repo/prod.rogen.json", config());
			await start(["default", "prod"]);

			await write("/repo/prod.rogen.json", "{ broken");
			await settle();
			await fs.writeFile("/repo/src/A.luau", "");
			await settle();

			expect(await built("default")).toEqual(["A"]);
			expect(await built("prod")).toEqual(["A"]);
		});

		it("should build from a config again once it is valid", async () => {
			await start();
			await write("/repo/default.rogen.json", "{ broken");
			await settle();

			await write(
				"/repo/default.rogen.json",
				config({ rootDirs: ["lib"] })
			);
			await fs.createDirectory("/repo/lib");
			await fs.writeFile("/repo/lib/L.luau", "");
			await settle();

			expect(await built("default")).toEqual(["L"]);
		});
	});
});
