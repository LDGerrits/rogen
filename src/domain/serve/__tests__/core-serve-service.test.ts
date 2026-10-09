import { jest } from "@jest/globals";
import { UsageError } from "../../../base/errors.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { buildServiceOf } from "../../build/__tests__/fixtures.js";
import { CoreBuildService } from "../../build/core-build-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { CoreWatchService } from "../../watch/core-watch-service.js";
import { CoreServeService } from "../core-serve-service.js";
import { SyncServer } from "../serve.js";
import {
	ServePlan,
	ServeRequest,
	ServeSession,
	ServerStop,
	ServingServer,
} from "../serve-service.js";

const config = (extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		rootDirs: ["src"],
		routes: { "*": "ReplicatedStorage" },
		...extra,
	});

const template = (fields: Record<string, unknown>) =>
	JSON.stringify({ tree: { $className: "DataModel" }, ...fields });

const rojoInfo = (project: string) => ({
	projectName: project,
	serverVersion: "7.7.1",
	sessionId: "s1",
});

describe("CoreServeService", () => {
	let memFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let processes: MockProcessService;
	let requests: MockRequestService;
	let configService: CoreConfigService;
	let service: CoreServeService;

	const prepare = (request: Partial<ServeRequest> = {}) =>
		service.prepare({ refs: [], options: {}, serverArgs: [], ...request });

	const plan = async (request: Partial<ServeRequest> = {}) =>
		(await prepare(request)).unwrap();

	const errorOf = async (request: Partial<ServeRequest> = {}) => {
		const result = await prepare(request);
		if (result.isOk()) throw new Error("expected a failure");
		return result.error;
	};

	const served = (servePlan: ServePlan) =>
		servePlan.targets.map(({ config, address }) => [
			config.label,
			address.toString(),
		]);

	beforeEach(async () => {
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory("/repo/src");
		await memFs.writeFile("/repo/src/A.luau", "");
		await memFs.writeFile(
			"/repo/rokit.toml",
			'[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n'
		);
		await memFs.writeFile("/repo/default.rogen.json", config());
		watcher = new MemoryWatcher(memFs, new NullLogService());
		processes = new MockProcessService(
			new Map([["rojo", "/bin/rojo"]]),
			new Map([
				["/bin/rojo", { code: 0, stdout: "Rojo 7.7.1", stderr: "" }],
			])
		);
		requests = new MockRequestService();
		configService = new CoreConfigService(
			memFs,
			new MockEnvironmentService("/repo")
		);
		const index = new CoreIndexService(memFs);
		service = new CoreServeService(
			configService,
			memFs,
			processes,
			requests,
			new CoreWatchService(watcher, index, buildServiceOf(memFs, index)),
			new MockEnvironmentService("/repo", undefined, false, "/home/me")
		);
	});

	afterEach(async () => {
		await watcher.stop();
	});

	describe("prepare", () => {
		it("should serve the one config on Rojo's default port", async () => {
			const servePlan = await plan();

			expect(served(servePlan)).toEqual([["default", "127.0.0.1:34872"]]);
			expect(servePlan.tool).toEqual({
				server: SyncServer.ROJO,
				file: "/bin/rojo",
				version: "7.7.1",
				passedOver: undefined,
			});
			expect(servePlan.toStart).toHaveLength(1);
		});

		it("should serve the synced config of a Darklua setup, not the source-rooted one", async () => {
			await memFs.writeFile(
				"/repo/sync.rogen.json",
				JSON.stringify({
					extends: "./default.rogen.json",
					syncDir: "dist",
				})
			);

			expect(served(await plan())).toEqual([["sync", "127.0.0.1:34872"]]);
		});

		it("should serve each place on the port its template sets", async () => {
			await memFs.writeFile(
				"/repo/places/lobby.project.json",
				template({ servePort: 34900, name: "Lobby" })
			);
			await memFs.writeFile(
				"/repo/places/shop.project.json",
				template({ servePort: 34901, serveAddress: "0.0.0.0" })
			);
			await memFs.writeFile(
				"/repo/lobby.rogen.json",
				JSON.stringify({
					extends: "./default.rogen.json",
					template: "places/lobby.project.json",
				})
			);
			await memFs.writeFile(
				"/repo/shop.rogen.json",
				JSON.stringify({
					extends: "./default.rogen.json",
					template: "places/shop.project.json",
				})
			);

			const servePlan = await plan();

			expect(served(servePlan)).toEqual([
				["lobby", "127.0.0.1:34900"],
				["shop", "0.0.0.0:34901"],
			]);
			expect(servePlan.targets.map(({ project }) => project)).toEqual([
				"Lobby",
				"repo",
			]);
		});

		it("should serve only the configs asked for, extended or not", async () => {
			await memFs.writeFile(
				"/repo/sync.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);

			const servePlan = await plan({ refs: ["default"] });

			expect(served(servePlan)).toEqual([["default", "127.0.0.1:34872"]]);
			expect(servePlan.selection.entries).toHaveLength(2);
		});

		it("should watch only the named configs when a config here is broken", async () => {
			await memFs.writeFile("/repo/broken.rogen.json", "{ nope");

			const servePlan = await plan({ refs: ["default"] });

			expect(served(servePlan)).toEqual([["default", "127.0.0.1:34872"]]);
			expect(servePlan.selection.entries.map(({ file }) => file)).toEqual(
				["/repo/default.rogen.json"]
			);
		});

		it("should watch a config named from another folder on its own", async () => {
			await memFs.writeFile(
				"/elsewhere/lobby.rogen.json",
				config({ rootDirs: ["/repo/src"] })
			);

			const servePlan = await plan({
				refs: ["/elsewhere/lobby.rogen.json"],
			});

			expect(servePlan.selection.entries.map(({ file }) => file)).toEqual(
				["/elsewhere/lobby.rogen.json"]
			);
		});

		it("should take the port and address given after --", async () => {
			const servePlan = await plan({
				serverArgs: ["--port", "40000", "--address", "0.0.0.0"],
			});

			expect(served(servePlan)).toEqual([["default", "0.0.0.0:40000"]]);
			expect(requests.requested[0]).toBe(
				"http://127.0.0.1:40000/api/rojo"
			);
		});

		it("should refuse a port after -- that isn't one", async () => {
			const error = await errorOf({ serverArgs: ["--port", "high"] });

			expect(error).toEqual(
				new UsageError(
					"The --port after '--' takes a number from 1 to 65535."
				)
			);
		});

		it("should read Argon's port from its settings beside the project file, else its own default", async () => {
			processes.installed.set("argon", "/bin/argon");
			processes.outputs.set("/bin/argon", {
				code: 0,
				stdout: "argon 2.0.24",
				stderr: "",
			});
			await memFs.writeFile(
				"/home/me/.argon/config.toml",
				'host = "0.0.0.0"\nport = 8100\n'
			);

			expect(served(await plan({ server: SyncServer.ARGON }))).toEqual([
				["default", "0.0.0.0:8100"],
			]);

			await memFs.writeFile("/repo/argon.toml", "port = 8200 # mine\n");

			expect(served(await plan({ server: SyncServer.ARGON }))).toEqual([
				["default", "localhost:8200"],
			]);
		});

		it("should refuse two configs on one port, naming them and the fix", async () => {
			await memFs.writeFile(
				"/repo/lobby.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);
			await memFs.writeFile(
				"/repo/shop.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);

			const error = await errorOf();

			expect(error).toBeInstanceOf(UsageError);
			expect(error.message).toBe(
				"lobby and shop both serve on port 34872.\nGive each its own servePort in its template, or serve one at a time, as 'rogen serve lobby'."
			);
		});

		it("should say a --port after -- is shared by every config served", async () => {
			await memFs.writeFile(
				"/repo/lobby.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);
			await memFs.writeFile(
				"/repo/shop.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);
			await memFs.writeFile(
				"/repo/arena.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);

			const error = await errorOf({ serverArgs: ["--port", "40000"] });

			expect(error.message).toBe(
				"arena, lobby and shop all serve on port 40000.\nThe --port after '--' applies to every config: serve one at a time, as 'rogen serve arena -- --port <port>'."
			);
		});

		it("should find a config a server already serves, and start nothing for it", async () => {
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const servePlan = await plan();

			expect(servePlan.running.map(({ running }) => running)).toEqual([
				{
					server: SyncServer.ROJO,
					project: "repo",
					version: "7.7.1",
					session: "s1",
				},
			]);
			expect(servePlan.toStart).toEqual([]);
		});

		it("should not take a server for a place's own when the places share its project name", async () => {
			await memFs.writeFile(
				"/repo/lobby.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);
			await memFs.writeFile(
				"/repo/match.rogen.json",
				JSON.stringify({ extends: "./default.rogen.json" })
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const error = (await errorOf({
				refs: ["match"],
			})) as DiagnosticsError;

			expect(error.diagnostics[0].code).toBe("serve.portTaken");
			expect(error.diagnostics[0].message).toContain(
				"Port 34872 is taken by Rojo serving repo, so match can't be served there."
			);
		});

		it("should take a running server for the synced config's own, though its base has the same name", async () => {
			await memFs.writeFile(
				"/repo/sync.rogen.json",
				JSON.stringify({
					extends: "./default.rogen.json",
					syncDir: "dist",
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const servePlan = await plan();

			expect(servePlan.running.map(({ config }) => config.label)).toEqual(
				["sync"]
			);
		});

		it("should refuse a server that another checkout of the project started", async () => {
			await memFs.writeFile(
				"/mock/tmp/rogen-serve/34872.json",
				JSON.stringify({
					session: "s1",
					project: "repo",
					projectFile: "/other/repo/default.project.json",
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const error = (await errorOf()) as DiagnosticsError;

			expect(error.diagnostics[0].message).toContain(
				"Port 34872 is taken by Rojo serving repo from /other/repo, so default can't be served there."
			);
		});

		it("should ignore a record left by a server that no longer runs", async () => {
			await memFs.writeFile(
				"/mock/tmp/rogen-serve/34872.json",
				JSON.stringify({
					session: "old",
					project: "repo",
					projectFile: "/other/repo/default.project.json",
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			expect((await plan()).running).toHaveLength(1);
		});

		it("should refuse a port another project's server holds, offering a free one", async () => {
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("Other")
			);
			requests.responses.set(
				"http://127.0.0.1:34873/api/rojo",
				"timeout"
			);

			const error = await errorOf();

			expect(error).toBeInstanceOf(DiagnosticsError);
			const [diagnostic] = (error as DiagnosticsError).diagnostics;
			expect(diagnostic.code).toBe("serve.portTaken");
			expect(diagnostic.resource).toBe("/repo/default.rogen.json");
			expect(diagnostic.message).toBe(
				"Port 34872 is taken by Rojo serving Other, so default can't be served there. Give default a template with its own servePort, or run 'rogen serve default -- --port 34874'."
			);
			expect(diagnostic.fixes).toEqual([
				{
					run: {
						command: "rogen serve default -- --port 34874",
						cwd: "/repo",
					},
				},
			]);
		});

		it("should point a taken port at the template that sets it", async () => {
			await memFs.writeFile(
				"/repo/game.project.json",
				template({ servePort: 34900 })
			);
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({ template: "game.project.json" })
			);
			requests.responses.set("http://127.0.0.1:34900/api/rojo", {
				status: 404,
				contentType: "text/plain",
				body: new Uint8Array(),
			});

			const error = (await errorOf()) as DiagnosticsError;

			expect(error.diagnostics[0].resource).toBe(
				"/repo/game.project.json"
			);
			expect(error.diagnostics[0].message).toBe(
				"Port 34900 is taken by another program, so default can't be served there. Give default its own servePort in game.project.json, or run 'rogen serve default -- --port 34901'."
			);
		});

		it("should fail with a broken config's errors before looking for a server", async () => {
			await memFs.writeFile("/repo/default.rogen.json", '{"nope": 1}');

			const error = await errorOf();

			expect(error).toBeInstanceOf(DiagnosticsError);
			expect(processes.execs).toEqual([]);
		});
	});

	describe("serve", () => {
		let session: ServeSession;
		let served: ServingServer[];
		let stops: ServerStop[];
		let said: string[];

		const settle = async () => {
			for (let i = 0; i < 20; i++)
				await jest.advanceTimersByTimeAsync(100);
		};

		const start = async () => {
			session = service.serve(await plan()).unwrap();
			served = [];
			stops = [];
			session.onDidServe((serving) => served.push(serving));
			said = [];
			session.onDidSay(({ message }) =>
				said.push(`${message.severity}: ${message.text}`)
			);
			session.onDidStop((stop) => {
				said.push("stopped");
				stops.push(stop);
			});
			const started = session.start();
			await settle();
			return started;
		};

		beforeEach(() => {
			jest.useFakeTimers();
		});

		afterEach(async () => {
			await session?.stop();
			session?.[Symbol.dispose]();
			jest.restoreAllMocks();
			jest.useRealTimers();
		});

		it("should build, then start the server on the project file", async () => {
			expect(await memFs.exists("/repo/default.project.json")).toBe(
				false
			);
			const spawn = processes.spawn.bind(processes);
			const builtAtSpawn: Promise<boolean>[] = [];
			jest.spyOn(processes, "spawn").mockImplementation((...args) => {
				builtAtSpawn.push(memFs.exists("/repo/default.project.json"));
				return spawn(...args);
			});

			expect((await start()).isOk()).toBe(true);

			expect(await Promise.all(builtAtSpawn)).toEqual([true]);
			expect(
				processes.spawned.map(({ file, args, options }) => [
					file,
					args,
					options,
				])
			).toEqual([
				[
					"/bin/rojo",
					["serve", "default.project.json"],
					{ cwd: "/repo" },
				],
			]);
		});

		it("should say a server serves once it answers for its project", async () => {
			await start();
			expect(served).toEqual([]);

			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);
			await settle();

			expect(
				served.map(({ target, info }) => [
					target.config.label,
					info.version,
				])
			).toEqual([["default", "7.7.1"]]);
		});

		it("should start nothing when the first build fails, and fail with its errors", async () => {
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({
					routes: {
						server: "ServerScriptService",
						client: "StarterPlayer/StarterPlayerScripts",
						"*": "ReplicatedStorage",
					},
				})
			);
			await memFs.writeFile("/repo/src/X/@server", "");
			await memFs.writeFile("/repo/src/X/@client", "");

			const started = await start();

			expect(
				started.isErr() &&
					(started.error as DiagnosticsError).diagnostics[0].code
			).toBe("route.markerClash");
			expect(processes.spawned).toEqual([]);
		});

		it("should record the server once it answers, and drop the record on stop", async () => {
			await start();
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);
			await settle();

			expect(
				JSON.parse(
					await memFs.readFile("/mock/tmp/rogen-serve/34872.json")
				)
			).toEqual({
				session: "s1",
				project: "repo",
				projectFile: "/repo/default.project.json",
			});

			await session.stop();

			expect(await memFs.exists("/mock/tmp/rogen-serve/34872.json")).toBe(
				false
			);
		});

		it("should fail to start, starting nothing, when the first build throws", async () => {
			jest.spyOn(CoreBuildService.prototype, "rebuild").mockRejectedValue(
				new Error("disk on fire")
			);

			const started = await start();

			expect(started.isErr() && started.error.message).toBe(
				"disk on fire"
			);
			expect(processes.spawned).toEqual([]);
		});

		it("should report a server that stops on its own as a failure with its exit code", async () => {
			await start();

			processes.spawned[0].exit({ code: 1, signal: null });

			expect(stops).toHaveLength(1);
			expect(stops[0].interrupted).toBe(false);
			expect(stops[0].failure?.code).toBe("serve.serverExited");
			expect(stops[0].failure?.message).toBe(
				"Rojo stopped serving default with exit code 1, without saying why."
			);
		});

		it("should pass on what the server said before it stopped, and point to it", async () => {
			await start();

			processes.spawned[0].print("[ERROR librojo] Port in use");
			processes.spawned[0].exit({ code: 1, signal: null });

			expect(said).toEqual(["error: Port in use", "stopped"]);
			expect(stops[0].failure?.message).toBe(
				"Rojo stopped serving default with exit code 1; see what it said above."
			);
		});

		it("should show a Windows status code in hex", async () => {
			await start();

			processes.spawned[0].exit({ code: 0xc0000005, signal: null });

			expect(stops[0].failure?.message).toBe(
				"Rojo stopped serving default with exit code 0xC0000005, without saying why."
			);
		});

		it("should not count a server that Ctrl+C ended as a failure", async () => {
			await start();

			processes.spawned[0].exit({ code: 130, signal: null });

			expect(stops[0].interrupted).toBe(true);
			expect(stops[0].failure).toBeUndefined();
		});

		it("should report a server that couldn't start", async () => {
			await start();

			processes.spawned[0].exit({
				code: null,
				signal: null,
				error: new Error("spawn /bin/rojo EACCES"),
			});

			expect(stops[0].failure?.message).toBe(
				"Rojo couldn't start to serve default: spawn /bin/rojo EACCES"
			);
		});

		it("should end the servers on stop, without reporting them as stopped", async () => {
			await start();

			await session.stop();

			expect(processes.spawned[0].terminated).toBe(true);
			expect(stops).toEqual([]);
		});
	});
});
