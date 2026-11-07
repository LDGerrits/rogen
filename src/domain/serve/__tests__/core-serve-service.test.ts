import { jest } from "@jest/globals";
import { DeferredPromise } from "../../../base/async.js";
import { UsageError } from "../../../base/errors.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { writeServiceOf } from "../../write/__tests__/fixtures.js";
import { CoreWriteService } from "../../write/core-write-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { CoreRojoRunner } from "../../runner/core-rojo-runner.js";
import { RojoCompatibility } from "../../runner/rojo-compatibility.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { CoreWatchService } from "../../watch/core-watch-service.js";
import { CoreServeService } from "../core-serve-service.js";

import { recordFile } from "./record-fixtures.js";
import {
	ServePlan,
	ServeRequest,
	ServeChangeEvent,
	ServeSession,
	ServerExitEvent,
	ServerReadyEvent,
	ServerRestartEvent,
} from "../serve-service.js";

type Fields = Record<string, unknown>;

const config = (fields: Fields = {}) =>
	JSON.stringify({
		sourcePaths: ["src"],
		routes: { "*": "ReplicatedStorage" },
		...fields,
	});

const place = (fields: Fields = {}) =>
	config({ sourcePaths: ["../src"], ...fields });

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
		service.prepare({ refs: [], serverArgs: [], ...request });

	const plan = async (request: Partial<ServeRequest> = {}) =>
		(await prepare(request)).unwrap();

	const errorOf = async (request: Partial<ServeRequest> = {}) => {
		const result = await prepare(request);
		if (result.isOk()) throw new Error("expected a failure");
		return result.error;
	};

	const served = ({ target }: ServePlan) => [
		target.config.label,
		target.address.toString(),
	];

	const serviceAt = (cwd: string, compatibility?: RojoCompatibility) => {
		configService = new CoreConfigService(
			memFs,
			new MockEnvironmentService(cwd)
		);
		const index = new CoreIndexService(memFs);
		return new CoreServeService(
			configService,
			memFs,
			new CoreRojoRunner(new CoreToolchainService(memFs), processes),
			requests,
			new CoreWatchService(watcher, index, writeServiceOf(memFs, index)),
			new MockEnvironmentService(cwd, undefined, false, "/home/me"),
			compatibility
		);
	};

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
		service = serviceAt("/repo");
	});

	afterEach(async () => {
		await watcher.stop();
	});

	describe("prepare", () => {
		it("should serve the one config on Rojo's default port", async () => {
			const servePlan = await plan();

			expect(served(servePlan)).toEqual(["repo", "127.0.0.1:34872"]);
			expect(servePlan.executable).toEqual({
				file: "/bin/rojo",
				version: "7.7.1",
			});
			expect(servePlan.target.servedBy).toBeUndefined();
		});

		it("should serve a place on the port and address its default.rogen.json sets", async () => {
			await memFs.writeFile(
				"/repo/lobby/default.rogen.json",
				place({
					servePort: 34900,
					serveAddress: "0.0.0.0",
					name: "Lobby",
				})
			);

			const servePlan = await plan({ refs: ["lobby"] });

			expect(served(servePlan)).toEqual(["Lobby", "0.0.0.0:34900"]);
			expect(servePlan.target.project).toBe("Lobby");
		});

		it("should serve only the named configs", async () => {
			await memFs.writeFile("/repo/lobby/default.rogen.json", place());

			const servePlan = await plan({ refs: ["."] });

			expect(served(servePlan)).toEqual(["repo", "127.0.0.1:34872"]);
			expect(servePlan.selection.entries.map(({ file }) => file)).toEqual(
				["/repo/default.rogen.json"]
			);
		});

		it("should fail when a named config is broken, before looking for a server", async () => {
			await memFs.writeFile("/repo/lobby/default.rogen.json", "{ nope");

			const error = await errorOf({ refs: ["lobby"] });

			expect(error).toBeInstanceOf(DiagnosticsError);
			expect(processes.execs).toEqual([]);
		});

		it("should watch a config named from another folder on its own", async () => {
			await memFs.writeFile(
				"/elsewhere/lobby/default.rogen.json",
				config({ sourcePaths: ["/repo/src"] })
			);

			const servePlan = await plan({ refs: ["/elsewhere/lobby"] });

			expect(servePlan.selection.entries.map(({ file }) => file)).toEqual(
				["/elsewhere/lobby/default.rogen.json"]
			);
		});

		it("should take the port and address given as flags", async () => {
			const servePlan = await plan({
				serverArgs: ["--port", "40000", "--address", "0.0.0.0"],
			});

			expect(served(servePlan)).toEqual(["repo", "0.0.0.0:40000"]);
			expect(requests.requested[0]).toBe(
				"http://127.0.0.1:40000/api/rojo"
			);
		});

		it("should refuse a flag the Rojo that runs doesn't take yet, naming the release that added it", async () => {
			processes.outputs.set("/bin/rojo", {
				code: 0,
				stdout: "Rojo 7.6.1",
				stderr: "",
			});

			const error = await errorOf({
				serverArgs: ["--allowed-hosts"],
			});

			expect(error).toEqual(
				new UsageError(
					"--allowed-hosts needs Rojo 7.7.0 or later, and the Rojo that runs here is 7.6.1.",
					"Change your Rojo pin to 7.7.0 or later, or update the Rojo on the PATH, or leave the flag out."
				)
			);
		});

		it("should refuse a port that isn't one", async () => {
			const error = await errorOf({ serverArgs: ["--port", "high"] });

			expect(error).toEqual(
				new UsageError("--port takes a number from 1 to 65535.")
			);
		});

		it("should find a config a server already serves, and start nothing for it", async () => {
			processes.running.add(5000);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					owner: 5000,
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const servePlan = await plan();

			expect(servePlan.target.servedBy).toEqual({
				project: "repo",
				version: "7.7.1",
				session: "s1",
			});
			expect(servePlan.isIdle).toBe(true);
		});

		it("should refuse a server no serve started that serves a project of the same name, and name it as another process", async () => {
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const error = (await errorOf()) as DiagnosticsError;

			expect(error.diagnostics[0].code).toBe("serve.portTaken");
			expect(error.diagnostics[0].resource).toBe(
				"/repo/default.rogen.json"
			);
			expect(error.diagnostics[0].message).toBe(
				"Port 34872 is held by another process (Rojo serving repo), so default.rogen.json can't be served there. Stop it, set a servePort in default.rogen.json, or run 'rogen serve --port <port>'."
			);
		});

		it("should refuse a server that another checkout of the project started", async () => {
			await memFs.writeFile(
				...recordFile(34872, "repo", "/other/repo/default.project.json")
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const error = (await errorOf()) as DiagnosticsError;

			expect(error.diagnostics[0].message).toContain(
				"Port 34872 is taken by Rojo serving repo, which rogen serve started for /other/repo/default.project.json, so default.rogen.json can't be served there."
			);
		});

		it("should name the config another serve started on the port", async () => {
			await memFs.writeFile(
				"/repo/dist.rogen.json",
				config({ name: "repo", compiledPath: "dist" })
			);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					configFile: "/repo/default.rogen.json",
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const error = (await errorOf({
				refs: ["dist"],
			})) as DiagnosticsError;

			expect(error.diagnostics[0].message).toBe(
				"Port 34872 is taken by Rojo serving repo, which rogen serve started for default.rogen.json, so dist.rogen.json can't be served there. Stop it, set a servePort in dist.rogen.json, or run 'rogen serve dist --port <port>'."
			);
		});

		it("should name the config by its file when its bare name reads a folder", async () => {
			await memFs.writeFile(
				"/repo/dist.rogen.json",
				config({ name: "repo", compiledPath: "dist" })
			);
			await memFs.writeFile(
				"/repo/dist/default.rogen.json",
				config({ name: "dist" })
			);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					configFile: "/repo/default.rogen.json",
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const error = (await errorOf({
				refs: ["dist.rogen.json"],
			})) as DiagnosticsError;

			expect(error.diagnostics[0].message).toContain(
				"or run 'rogen serve dist.rogen.json --port <port>'."
			);
		});

		it("should name the place another serve started on the port, in another folder", async () => {
			await memFs.writeFile(
				"/repo/places/lobby/default.rogen.json",
				place({ name: "Lobby" })
			);
			await memFs.writeFile(
				"/repo/places/arena/default.rogen.json",
				place({ name: "Lobby" })
			);
			await memFs.writeFile(
				...recordFile(
					34872,
					"Lobby",
					"/repo/places/lobby/default.project.json",
					{ configFile: "/repo/places/lobby/default.rogen.json" }
				)
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("Lobby")
			);

			const error = (await errorOf({
				refs: ["places/arena"],
			})) as DiagnosticsError;

			expect(error.diagnostics[0].message).toBe(
				"Port 34872 is taken by Rojo serving Lobby, which rogen serve started for places/lobby/default.rogen.json, so places/arena/default.rogen.json can't be served there. Stop it, set a servePort in places/arena/default.rogen.json, or run 'rogen serve places/arena --port <port>'."
			);
		});

		it("should leave a server alone that another serve recorded for this project file before its name changed", async () => {
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({ name: "Game" })
			);
			processes.running.add(5000);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					owner: 5000,
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const servePlan = await plan();

			expect(servePlan.target.servedBy).toMatchObject({
				project: "repo",
			});
		});

		it("should leave a server alone whose serve still runs", async () => {
			processes.running.add(5000);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					owner: 5000,
					pid: 5001,
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const servePlan = await plan();

			expect(servePlan.target.servedBy).toBeDefined();
		});

		it("should find the server another serve started for the project on a port given as a flag, when no port is given", async () => {
			processes.running.add(5000);
			await memFs.writeFile(
				...recordFile(37001, "repo", "/repo/default.project.json", {
					owner: 5000,
				})
			);
			requests.answer(
				"http://127.0.0.1:37001/api/rojo",
				rojoInfo("repo")
			);

			const servePlan = await plan();

			expect(servePlan.isIdle).toBe(true);
			expect(servePlan.target.address.port).toBe(37001);
		});

		it("should start another server for the project when a port is given", async () => {
			processes.running.add(5000);
			await memFs.writeFile(
				...recordFile(37001, "repo", "/repo/default.project.json", {
					owner: 5000,
				})
			);
			requests.answer(
				"http://127.0.0.1:37001/api/rojo",
				rojoInfo("repo")
			);

			const servePlan = await plan({ serverArgs: ["--port", "37002"] });

			expect(servePlan.isIdle).toBe(false);
			expect(servePlan.target.address.port).toBe(37002);
		});

		it.each([
			["another project file", "/other/default.project.json", 5000],
			["a serve that ended", "/repo/default.project.json", 5001],
			["no serve", "/repo/default.project.json", undefined],
		])(
			"should not take a server recorded for %s as this project's",
			async (_, projectFile, owner) => {
				processes.running.add(5000);
				await memFs.writeFile(
					...recordFile(37001, "repo", projectFile, { owner })
				);
				requests.answer(
					"http://127.0.0.1:37001/api/rojo",
					rojoInfo("repo")
				);

				const servePlan = await plan();

				expect(servePlan.isIdle).toBe(false);
				expect(servePlan.target.address.port).toBe(34872);
			}
		);

		it.each([
			[
				"the process that leads it is gone too",
				{ owner: 5000, pid: 5001 },
			],
			["the record names no leading process", { owner: 5000 }],
			["the record names no serve", { pid: 5001 }],
		])(
			"should refuse a server recorded for this project file when %s",
			async (_, recorded) => {
				await memFs.writeFile(
					...recordFile(
						34872,
						"repo",
						"/repo/default.project.json",
						recorded
					)
				);
				requests.answer(
					"http://127.0.0.1:34872/api/rojo",
					rojoInfo("repo")
				);

				const error = (await errorOf()) as DiagnosticsError;

				expect(error.diagnostics[0]).toMatchObject({
					code: "serve.portTaken",
					message: expect.stringContaining(
						"Port 34872 is held by another process (Rojo serving repo)"
					),
				});
			}
		);

		it("should refuse a server recorded by a serve that named no owner, even while its leading process runs", async () => {
			processes.running.add(5001);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					pid: 5001,
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const error = (await errorOf()) as DiagnosticsError;

			expect(error.diagnostics[0].code).toBe("serve.portTaken");
			expect(processes.terminatedTrees).toEqual([]);
		});

		it("should start over a server whose serve ended, and name what it leaves", async () => {
			processes.running.add(5001);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					owner: 5000,
					pid: 5001,
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const servePlan = await plan();

			expect(servePlan.target.servedBy).toBeUndefined();
			expect(servePlan.target.orphan?.pid).toBe(5001);
			expect(servePlan.isIdle).toBe(false);
		});

		it("should not take a record left by another session as the record of the server", async () => {
			await memFs.writeFile(
				...recordFile(
					34872,
					"repo",
					"/other/repo/default.project.json",
					{
						session: "old",
					}
				)
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			const error = (await errorOf()) as DiagnosticsError;

			expect(error.diagnostics[0].message).toContain(
				"Port 34872 is held by another process (Rojo serving repo)"
			);
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
				"Port 34872 is held by another process (Rojo serving Other), so default.rogen.json can't be served there. Stop it, set a servePort in default.rogen.json, or run 'rogen serve --port <port>'."
			);
			expect(diagnostic.fixes).toEqual([
				{
					run: {
						command: "rogen serve --port 34874",
						cwd: "/repo",
					},
				},
			]);
		});

		it("should keep the other server flags in the command it offers for a taken port", async () => {
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("Other")
			);

			const error = await errorOf({
				serverArgs: [
					"--address",
					"0.0.0.0",
					"--port=34872",
					"--allowed-hosts",
					"my pc",
				],
			});

			expect(
				(error as DiagnosticsError).diagnostics[0].fixes?.[0]
			).toEqual({
				run: {
					command:
						"rogen serve --port 34873 --address 0.0.0.0 --allowed-hosts 'my pc'",
					cwd: "/repo",
				},
			});
		});

		it("should name the default.rogen.json of the config in a taken port's error", async () => {
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({ servePort: 34900 })
			);
			requests.responses.set("http://127.0.0.1:34900/api/rojo", {
				status: 404,
				contentType: "text/plain",
				body: new Uint8Array(),
			});

			const error = (await errorOf()) as DiagnosticsError;

			expect(error.diagnostics[0].resource).toBe(
				"/repo/default.rogen.json"
			);
			expect(error.diagnostics[0].message).toBe(
				"Port 34900 is held by another process, so default.rogen.json can't be served there. Stop it, set a servePort in default.rogen.json, or run 'rogen serve --port <port>'."
			);
		});

		it("should name no port to run on when none of the next twenty is free", async () => {
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({ servePort: 34900 })
			);
			for (let port = 34900; port <= 34920; port++) {
				requests.responses.set(`http://127.0.0.1:${port}/api/rojo`, {
					status: 404,
					contentType: "text/plain",
					body: new Uint8Array(),
				});
			}

			const error = (await errorOf()) as DiagnosticsError;

			expect(error.diagnostics[0].message).toContain(
				"or run 'rogen serve --port <port>'."
			);
			expect(error.diagnostics[0].fixes ?? []).toEqual([]);
		});

		it("should name no port to run on when the port is the last one", async () => {
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({ servePort: 65535 })
			);
			requests.responses.set("http://127.0.0.1:65535/api/rojo", {
				status: 404,
				contentType: "text/plain",
				body: new Uint8Array(),
			});

			const error = (await errorOf()) as DiagnosticsError;

			expect(error.diagnostics[0].message).toContain("--port <port>");
		});

		it("should fail with a broken config's errors before looking for a server", async () => {
			await memFs.writeFile("/repo/default.rogen.json", "{ nope");

			const error = await errorOf();

			expect(error).toBeInstanceOf(DiagnosticsError);
			expect(processes.execs).toEqual([]);
		});
	});

	describe("serve", () => {
		let session: ServeSession;
		let served: ServerReadyEvent[];
		let stops: ServerExitEvent[];
		let said: string[];
		let changes: string[];
		let connections: string[];
		let errored: Error[];

		const settle = async () => {
			for (let i = 0; i < 20; i++)
				await jest.advanceTimersByTimeAsync(100);
		};

		const start = async (request: Partial<ServeRequest> = {}) => {
			session = service.serve(await plan(request)).unwrap();
			served = [];
			stops = [];
			session.onDidServe((serving) => served.push(serving));
			connections = [];
			session.onDidConnect(({ target, opened, clients }) =>
				connections.push(
					`${target.config.label} ${opened ? "opened" : "closed"} ${clients}`
				)
			);
			said = [];
			session.onDidOutput(({ message }) =>
				said.push(`${message.severity}: ${message.text}`)
			);
			session.onDidExit((stop) => {
				said.push("stopped");
				stops.push(stop);
			});
			errored = [];
			session.onDidError((error) => errored.push(error));
			changes = [];
			session.onDidChange((change: ServeChangeEvent) =>
				changes.push(
					`${change.kind} ${change.target.config.label}${change.kind === "retired" ? ` (${change.reason})` : change.kind === "refused" ? `: ${change.diagnostic.message}` : change.kind === "orphan" ? ` (process ${change.pid} of ${change.owner})${change.error ? `: ${change.error}` : ""}` : ""}`
				)
			);
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

		it("should write, then start the server on the project file", async () => {
			expect(await memFs.exists("/repo/default.project.json")).toBe(
				false
			);
			const spawn = processes.spawn.bind(processes);
			const writtenAtSpawn: Promise<boolean>[] = [];
			jest.spyOn(processes, "spawn").mockImplementation((...args) => {
				writtenAtSpawn.push(memFs.exists("/repo/default.project.json"));
				return spawn(...args);
			});

			expect((await start()).isOk()).toBe(true);

			expect(await Promise.all(writtenAtSpawn)).toEqual([true]);
			expect(
				processes.spawned.map(({ file, args, options }) => [
					file,
					args,
					options,
				])
			).toEqual([
				[
					"/bin/rojo",
					["serve", "default.project.json", "--port", "34872"],
					{
						cwd: "/repo",
						env: { RUST_LOG: expect.any(Function) },
					},
				],
			]);
		});

		it("should start Rojo 7.7.0 on Windows for a file with a glob that starts with ../, since serve reads it right", async () => {
			processes.outputs.set("/bin/rojo", {
				code: 0,
				stdout: "Rojo 7.7.0",
				stderr: "",
			});
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({ globIgnorePaths: ["../shared/*.md"] })
			);
			service = serviceAt("/repo", new RojoCompatibility(memFs, true));

			const started = await start();

			expect(started.isOk()).toBe(true);
			expect(errored).toEqual([]);
		});

		it("should not start a Rojo before 7.5.0 for a file with sync rules", async () => {
			processes.outputs.set("/bin/rojo", {
				code: 0,
				stdout: "Rojo 7.4.4",
				stderr: "",
			});
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({ syncRules: [{ pattern: "*.md", use: "text" }] })
			);
			service = serviceAt("/repo", new RojoCompatibility(memFs, false));

			const started = await start();

			if (started.isOk()) throw new Error("expected a failure");
			expect(
				(started.error as DiagnosticsError).diagnostics.map(
					({ code, resource }) => [code, resource]
				)
			).toEqual([
				["rojo.syncRulesUnsupported", "/repo/default.project.json"],
			]);
			expect(errored).toEqual([started.error]);
			expect(processes.spawned).toEqual([]);
		});

		it("should start nothing for a change saved while it refuses a Rojo before 7.5.0", async () => {
			processes.outputs.set("/bin/rojo", {
				code: 0,
				stdout: "Rojo 7.4.4",
				stderr: "",
			});
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({ syncRules: [{ pattern: "*.md", use: "text" }] })
			);
			service = serviceAt("/repo", new RojoCompatibility(memFs, false));
			const checked = new DeferredPromise<void>();
			const problemsIn = RojoCompatibility.prototype.problemsIn;
			jest.spyOn(
				RojoCompatibility.prototype,
				"problemsIn"
			).mockImplementation(async function (
				this: RojoCompatibility,
				...args
			) {
				const problems = await problemsIn.apply(this, args);
				await checked.p;
				return problems;
			});
			const started = start();
			await settle();

			await memFs.writeFile("/repo/default.rogen.json", config());
			await settle();
			checked.complete();
			await settle();

			expect((await started).isErr()).toBe(true);
			expect(processes.spawned).toEqual([]);
		});

		it("should not start a Rojo before 7.5.0 for a file with sync rules once a failed first write is fixed", async () => {
			processes.outputs.set("/bin/rojo", {
				code: 0,
				stdout: "Rojo 7.4.4",
				stderr: "",
			});
			const routes = {
				server: "ServerScriptService",
				client: "StarterPlayer/StarterPlayerScripts",
				"*": "ReplicatedStorage",
			};
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({
					routes,
					syncRules: [{ pattern: "*.md", use: "text" }],
				})
			);
			await memFs.writeFile("/repo/src/X/@server", "");
			await memFs.writeFile("/repo/src/X/@client", "");
			service = serviceAt("/repo", new RojoCompatibility(memFs, false));
			const started = start();
			await settle();

			await memFs.delete("/repo/src/X/@client");
			await settle();

			const ended = await started;
			if (ended.isOk()) throw new Error("expected a failure");
			expect(
				(ended.error as DiagnosticsError).diagnostics.map(
					({ code }) => code
				)
			).toEqual(["rojo.syncRulesUnsupported"]);
			expect(errored).toEqual([ended.error]);
			expect(processes.spawned).toEqual([]);
		});

		it("should not start a Rojo before 7.5.0 for sync rules saved while it checks a failed first write", async () => {
			processes.outputs.set("/bin/rojo", {
				code: 0,
				stdout: "Rojo 7.4.4",
				stderr: "",
			});
			const routes = {
				server: "ServerScriptService",
				client: "StarterPlayer/StarterPlayerScripts",
				"*": "ReplicatedStorage",
			};
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({ routes })
			);
			await memFs.writeFile("/repo/src/X/@server", "");
			await memFs.writeFile("/repo/src/X/@client", "");
			service = serviceAt("/repo", new RojoCompatibility(memFs, false));
			const checked = new DeferredPromise<void>();
			const problemsIn = RojoCompatibility.prototype.problemsIn;
			jest.spyOn(
				RojoCompatibility.prototype,
				"problemsIn"
			).mockImplementation(async function (
				this: RojoCompatibility,
				...args
			) {
				const problems = await problemsIn.apply(this, args);
				await checked.p;
				return problems;
			});
			const started = start();
			await settle();

			await memFs.delete("/repo/src/X/@client");
			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({
					routes,
					syncRules: [{ pattern: "*.md", use: "text" }],
				})
			);
			await settle();
			checked.complete();
			await settle();

			const ended = await started;
			if (ended.isOk()) throw new Error("expected a failure");
			expect(
				(ended.error as DiagnosticsError).diagnostics.map(
					({ code }) => code
				)
			).toEqual(["rojo.syncRulesUnsupported"]);
			expect(processes.spawned).toEqual([]);
		});

		it("should report sync rules once a Rojo before 7.5.0 is running", async () => {
			processes.outputs.set("/bin/rojo", {
				code: 0,
				stdout: "Rojo 7.4.4",
				stderr: "",
			});
			service = serviceAt("/repo", new RojoCompatibility(memFs, false));
			await start();
			const errors: Error[] = [];
			session.onDidError((error) => errors.push(error));

			await memFs.writeFile(
				"/repo/default.rogen.json",
				config({ syncRules: [{ pattern: "*.md", use: "text" }] })
			);
			await settle();

			expect(
				errors.map((error) =>
					(error as DiagnosticsError).diagnostics.map(
						({ code }) => code
					)
				)
			).toEqual([["rojo.syncRulesUnsupported"]]);
		});

		it("should tell when a Studio plugin connects to a server it started, and leaves it", async () => {
			await start();
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);
			await settle();

			processes.spawned[0].print(
				"[DEBUG librojo::web::api] WebSocket subscription established for session s1\n"
			);
			await settle();
			processes.spawned[0].print(
				"[DEBUG librojo::web::api] WebSocket subscription closed by client\n"
			);
			await settle();

			expect(connections).toEqual(["repo opened 1", "repo closed 0"]);
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
			).toEqual([["repo", "7.7.1"]]);
		});

		it("should keep watching when the first write fails, and start the server once a write succeeds", async () => {
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
			const updates: string[] = [];

			const started = start();
			await settle();
			session.onDidUpdate(({ reports }) =>
				updates.push(...reports.map(({ outcome }) => outcome.kind))
			);

			expect(processes.spawned).toEqual([]);

			await memFs.delete("/repo/src/X/@client");
			await settle();

			expect((await started).isOk()).toBe(true);
			expect(updates).toEqual(["wrote"]);
			expect(processes.spawned).toHaveLength(1);
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
				host: "127.0.0.1",
				port: 34872,
				session: "s1",
				project: "repo",
				projectFile: "/repo/default.project.json",
				configFile: "/repo/default.rogen.json",
				owner: 4242,
				pid: processes.spawned[0].pid,
			});

			await session.stop();

			expect(await memFs.exists("/mock/tmp/rogen-serve/34872.json")).toBe(
				false
			);
		});

		it("should end the server a dead serve left, then start its own, and say so", async () => {
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					owner: 5000,
					pid: 5001,
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);
			processes.running.add(5001);

			await start();

			expect(processes.terminatedTrees).toEqual([5001]);
			expect(processes.spawned).toHaveLength(1);
			expect(said).toEqual([]);
			expect(changes).toEqual(["orphan repo (process 5001 of 5000)"]);
		});

		it("should leave a server alone that went before the serve got to end it", async () => {
			processes.running.add(5001);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					owner: 5000,
					pid: 5001,
					session: "s1",
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);
			const planned = await plan();
			requests.responses.delete("http://127.0.0.1:34872/api/rojo");
			session = service.serve(planned).unwrap();
			said = [];
			session.onDidOutput(({ message }) => said.push(message.text));

			await session.start();
			await settle();

			expect(processes.terminatedTrees).toEqual([]);
			expect(said).toEqual([]);
			expect(processes.spawned).toHaveLength(1);
		});

		it("should say it couldn't end the server a dead serve left, and still start its own", async () => {
			processes.running.add(5001);
			jest.spyOn(processes, "terminateTree").mockRejectedValue(
				new Error("EINVAL")
			);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					owner: 5000,
					pid: 5001,
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			await start();

			expect(said).toEqual([]);
			expect(changes).toEqual([
				"orphan repo (process 5001 of 5000): EINVAL",
			]);
			expect(processes.spawned).toHaveLength(1);
		});

		it("should take over a server whose serve ended after this serve found it served", async () => {
			processes.running.add(5000);
			processes.running.add(5001);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					owner: 5000,
					pid: 5001,
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);
			await start();
			processes.running.delete(5000);

			await memFs.writeFile("/repo/src/B.luau", "");
			await settle();

			expect(processes.terminatedTrees).toEqual([5001]);
			expect(processes.spawned).toHaveLength(1);
		});

		it("should fail to start, starting nothing, when the first write throws", async () => {
			jest.spyOn(CoreWriteService.prototype, "rewrite").mockRejectedValue(
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
			await settle();

			expect(stops).toHaveLength(1);
			expect(stops[0]).toMatchObject({
				kind: "failed",
				failure: {
					code: "serve.serverExited",
					message:
						"Rojo stopped serving repo with exit code 1, without saying why.",
				},
			});
		});

		it("should pass on what the server said before it stopped, and point to it", async () => {
			await start();

			processes.spawned[0].print("[ERROR librojo] Port in use");
			processes.spawned[0].exit({ code: 1, signal: null });
			await settle();

			expect(said).toEqual(["error: Port in use", "stopped"]);
			expect(stops[0]).toMatchObject({
				failure: {
					message:
						"Rojo stopped serving repo with exit code 1; see what it said above.",
				},
			});
		});

		it("should stand down without a failure when another serve started a server for the project on its port first", async () => {
			await start();
			processes.running.add(5000);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					owner: 5000,
				})
			);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			processes.spawned[0].exit({ code: 1, signal: null });
			await settle();

			expect(stops).toHaveLength(1);
			expect(stops[0]).toMatchObject({
				kind: "served-elsewhere",
				servedBy: { project: "repo", version: "7.7.1", session: "s1" },
			});
		});

		it("should wait for the record of a server that answers for the project when its own couldn't start", async () => {
			await start();
			processes.running.add(5000);
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);

			processes.spawned[0].exit({ code: 1, signal: null });
			await jest.advanceTimersByTimeAsync(300);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					owner: 5000,
				})
			);
			await settle();

			expect(stops[0]).toMatchObject({
				kind: "served-elsewhere",
				servedBy: { project: "repo" },
			});
		});

		it("should stand down, not restart, when the server it took for its own was another serve's that started first", async () => {
			await start();
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);
			await settle();

			processes.spawned[0].print(
				"[ERROR librojo] Address already in use"
			);
			processes.spawned[0].exit({ code: 1, signal: null });
			await jest.advanceTimersByTimeAsync(300);
			processes.running.add(5000);
			await memFs.writeFile(
				...recordFile(34872, "repo", "/repo/default.project.json", {
					owner: 5000,
				})
			);
			await settle();

			expect(processes.spawned).toHaveLength(1);
			expect(stops).toHaveLength(1);
			expect(stops[0]).toMatchObject({
				kind: "served-elsewhere",
				servedBy: { session: "s1" },
			});
		});

		it("should stop waiting for another serve's record, and report nothing, once it is stopped", async () => {
			await start();
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("repo")
			);
			processes.spawned[0].exit({ code: 1, signal: null });
			await jest.advanceTimersByTimeAsync(300);

			await session.stop();
			const asked = requests.requested.length;
			await jest.advanceTimersByTimeAsync(6_000);

			expect(stops).toEqual([]);
			expect(requests.requested).toHaveLength(asked);
		});

		it("should fail as before when its server couldn't start and the port holds no server of the project", async () => {
			await start();
			requests.answer(
				"http://127.0.0.1:34872/api/rojo",
				rojoInfo("other")
			);

			processes.spawned[0].exit({ code: 1, signal: null });
			await settle();

			expect(stops[0]).toMatchObject({
				kind: "failed",
				failure: { code: "serve.serverExited" },
			});
		});

		describe("as its configs change", () => {
			const portOf = (servePort: number, extra = {}) =>
				memFs.writeFile(
					"/repo/default.rogen.json",
					config({ servePort, ...extra })
				);

			const replaceWithLobby = async (servePort = 34900, extra = {}) => {
				await memFs.delete("/repo/default.rogen.json");
				await memFs.writeFile(
					"/repo/default.rogen.jsonc",
					config({ name: "Lobby", servePort, ...extra })
				);
			};

			const occupy = (port: number) =>
				requests.responses.set(`http://127.0.0.1:${port}/api/rojo`, {
					status: 404,
					contentType: "text/plain",
					body: new Uint8Array(),
				});

			const spawnedProjects = () =>
				processes.spawned.map(({ args, terminated }) =>
					terminated ? `${args[1]} (ended)` : args[1]
				);

			it("should start a server for a config that takes the place of a removed one, once it is written", async () => {
				await start();

				await replaceWithLobby();
				await settle();

				expect(spawnedProjects()).toEqual([
					"default.project.json (ended)",
					"default.project.json",
				]);
				expect(
					JSON.parse(
						await memFs.readFile("/repo/default.project.json")
					).name
				).toBe("Lobby");
				requests.answer(
					"http://127.0.0.1:34900/api/rojo",
					rojoInfo("Lobby")
				);
				await settle();
				expect(served.map(({ target }) => target.config.label)).toEqual(
					["Lobby"]
				);
				expect(changes).toEqual(["retired repo (removed)"]);
			});

			it("should start a config that takes a place with errors only once it is written", async () => {
				await start();
				await memFs.writeFile("/repo/src/X/@server", "");
				await memFs.writeFile("/repo/src/X/@client", "");
				await replaceWithLobby(34900, {
					routes: {
						server: "ServerScriptService",
						client: "StarterPlayer/StarterPlayerScripts",
						"*": "ReplicatedStorage",
					},
				});
				await settle();
				expect(spawnedProjects()).toEqual([
					"default.project.json (ended)",
				]);

				await memFs.delete("/repo/src/X/@client");
				await settle();

				expect(spawnedProjects()).toEqual([
					"default.project.json (ended)",
					"default.project.json",
				]);
			});

			it("should keep a server where it is when its config moves it to a port another program holds", async () => {
				await start();
				occupy(34901);

				await portOf(34901);
				await settle();

				expect(spawnedProjects()).toEqual(["default.project.json"]);
				expect(changes).toEqual([
					"refused repo: Port 34901 is held by another process, so default.rogen.json can't be served there. Stop it, set a servePort in default.rogen.json, or run 'rogen serve --port <port>'.",
				]);
			});

			it("should refuse a config that takes the place of another on a port another program holds", async () => {
				await start();
				occupy(34900);

				await replaceWithLobby();
				await settle();

				expect(spawnedProjects()).toEqual([
					"default.project.json (ended)",
				]);
				expect(changes).toEqual([
					"retired repo (removed)",
					"refused Lobby: Port 34900 is held by another process, so default.rogen.jsonc can't be served there. Stop it, set a servePort in default.rogen.jsonc, or run 'rogen serve --port <port>'.",
				]);
			});

			it("should stop the server of a config that is removed, without calling it a failure", async () => {
				await start();

				await memFs.delete("/repo/default.rogen.json");
				await settle();

				expect(spawnedProjects()).toEqual([
					"default.project.json (ended)",
				]);
				expect(changes).toEqual(["retired repo (removed)"]);
				expect(stops).toEqual([]);
				expect(session.target).toBeUndefined();
			});

			it("should restart a server whose config moves it to another port", async () => {
				await start();

				await portOf(34901);
				await settle();

				expect(spawnedProjects()).toEqual([
					"default.project.json (ended)",
					"default.project.json",
				]);
				expect(changes).toEqual(["retired repo (moved)"]);
				expect(session.target?.address.toString()).toBe(
					"127.0.0.1:34901"
				);
				expect(stops).toEqual([]);
			});

			it("should start the server of a config another serve served once that server is gone", async () => {
				processes.running.add(5000);
				await memFs.writeFile(
					...recordFile(34872, "repo", "/repo/default.project.json", {
						owner: 5000,
					})
				);
				requests.answer(
					"http://127.0.0.1:34872/api/rojo",
					rojoInfo("repo")
				);
				await start();
				expect(spawnedProjects()).toEqual([]);

				requests.responses.delete("http://127.0.0.1:34872/api/rojo");
				await memFs.writeFile("/repo/src/B.luau", "");
				await settle();

				expect(spawnedProjects()).toEqual(["default.project.json"]);
			});

			it("should refuse a config again when it comes back after it was removed", async () => {
				await start();
				occupy(34900);
				await replaceWithLobby();
				await settle();
				await memFs.delete("/repo/default.rogen.jsonc");
				await settle();

				await memFs.writeFile(
					"/repo/default.rogen.jsonc",
					config({ name: "Lobby", servePort: 34900 })
				);
				await settle();

				expect(
					changes.filter((change) => change.startsWith("refused"))
				).toHaveLength(2);
			});

			it("should probe a refused config's port once per rewrite, not look for a free one again", async () => {
				await start();
				occupy(34900);
				await replaceWithLobby();
				await settle();
				requests.requested.length = 0;

				await memFs.writeFile("/repo/src/B.luau", "");
				await settle();

				expect(
					requests.requested.filter((url) => !url.includes(":34872/"))
				).toEqual(["http://127.0.0.1:34900/api/rojo"]);
			});

			it("should restart a server whose config moves only its host, without asking the port it holds", async () => {
				await start();
				requests.answer(
					"http://127.0.0.1:34872/api/rojo",
					rojoInfo("repo")
				);
				await settle();

				await portOf(34872, { serveAddress: "0.0.0.0" });
				await settle();

				expect(spawnedProjects()).toEqual([
					"default.project.json (ended)",
					"default.project.json",
				]);
				expect(changes).toEqual(["retired repo (moved)"]);
			});

			it("should take a refused config as served once its own project's server holds its port", async () => {
				await start();
				occupy(34900);
				await replaceWithLobby();
				await settle();

				processes.running.add(5000);
				await memFs.writeFile(
					...recordFile(
						34900,
						"Lobby",
						"/repo/default.project.json",
						{ owner: 5000 }
					)
				);
				requests.answer(
					"http://127.0.0.1:34900/api/rojo",
					rojoInfo("Lobby")
				);
				await memFs.writeFile("/repo/src/B.luau", "");
				await settle();

				expect(changes.map((change) => change.split(":")[0])).toEqual([
					"retired repo (removed)",
					"refused Lobby",
					"servedElsewhere Lobby",
				]);
			});

			it("should refuse a config another serve served once another project's server holds its port", async () => {
				processes.running.add(5000);
				await memFs.writeFile(
					...recordFile(34872, "repo", "/repo/default.project.json", {
						owner: 5000,
					})
				);
				requests.answer(
					"http://127.0.0.1:34872/api/rojo",
					rojoInfo("repo")
				);
				await start();

				requests.answer(
					"http://127.0.0.1:34872/api/rojo",
					rojoInfo("Other")
				);
				await memFs.writeFile("/repo/src/B.luau", "");
				await settle();
				requests.answer(
					"http://127.0.0.1:34872/api/rojo",
					rojoInfo("repo")
				);
				await memFs.writeFile("/repo/src/C.luau", "");
				await settle();

				expect(changes.map((change) => change.split(":")[0])).toEqual([
					"refused repo",
					"servedElsewhere repo",
				]);
			});

			it("should leave the server alone on a rewrite that changes no config", async () => {
				await start();

				await memFs.writeFile("/repo/src/B.luau", "");
				await settle();

				expect(spawnedProjects()).toEqual(["default.project.json"]);
				expect(changes).toEqual([]);
			});

			it("should know its server again after a crash once the config renames the project", async () => {
				await start();
				const restarts: ServerRestartEvent[] = [];
				session.onDidRestart((restart) => restarts.push(restart));
				requests.answer(
					"http://127.0.0.1:34872/api/rojo",
					rojoInfo("repo")
				);
				await settle();

				await memFs.writeFile(
					"/repo/default.rogen.json",
					config({ name: "Game" })
				);
				await settle();
				processes.spawned[0].printError(
					"[ERROR rojo] Rojo crashed! You are running Rojo 7.7.1.\n"
				);
				requests.responses.delete("http://127.0.0.1:34872/api/rojo");
				processes.spawned[0].exit({ code: 1, signal: null });
				await jest.advanceTimersByTimeAsync(0);
				requests.answer("http://127.0.0.1:34872/api/rojo", {
					...rojoInfo("Game"),
					sessionId: "s2",
				});
				await settle();

				expect(restarts.map(({ info }) => info.project)).toEqual([
					"Game",
				]);
			});

			it("should move the server to the port its config sets while it ends the server a dead serve left", async () => {
				await memFs.writeFile(
					...recordFile(34872, "repo", "/repo/default.project.json", {
						owner: 5000,
						pid: 5001,
					})
				);
				requests.answer(
					"http://127.0.0.1:34872/api/rojo",
					rojoInfo("repo")
				);
				processes.running.add(5001);
				const ended = new DeferredPromise<void>();
				jest.spyOn(processes, "terminateTree").mockReturnValue(ended.p);
				const started = start();
				await settle();

				await portOf(34901);
				await settle();
				requests.responses.delete("http://127.0.0.1:34872/api/rojo");
				ended.complete();
				await settle();

				expect((await started).isOk()).toBe(true);
				expect(spawnedProjects()).toEqual([
					"default.project.json (ended)",
					"default.project.json",
				]);
				expect(session.target?.address.toString()).toBe(
					"127.0.0.1:34901"
				);
			});

			it("should serve a config that takes the place of another while it checks the Rojo that runs", async () => {
				const checked = new DeferredPromise<void>();
				const problemsIn = RojoCompatibility.prototype.problemsIn;
				jest.spyOn(
					RojoCompatibility.prototype,
					"problemsIn"
				).mockImplementation(async function (
					this: RojoCompatibility,
					...args
				) {
					const problems = await problemsIn.apply(this, args);
					await checked.p;
					return problems;
				});
				const started = start();
				await settle();

				await replaceWithLobby();
				await settle();
				checked.complete();
				await settle();

				expect((await started).isOk()).toBe(true);
				expect(spawnedProjects()).toEqual([
					"default.project.json (ended)",
					"default.project.json",
				]);
				expect(changes).toEqual(["retired repo (removed)"]);
				expect(session.target?.config.label).toBe("Lobby");
			});

			it("should serve only the named configs, not one added beside them", async () => {
				await start({ refs: ["."] });

				await memFs.writeFile(
					"/repo/lobby/default.rogen.json",
					place({ name: "Lobby", servePort: 34900 })
				);
				await settle();

				expect(spawnedProjects()).toEqual(["default.project.json"]);
				expect(changes).toEqual([]);
			});
		});

		it("should end the servers on stop, without reporting them as stopped", async () => {
			await start();

			await session.stop();

			expect(processes.spawned[0].terminated).toBe(true);
			expect(stops).toEqual([]);
		});
	});
});
