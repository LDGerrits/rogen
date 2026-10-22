import { jest } from "@jest/globals";
import "../serve-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";

import { Result } from "../../../base/result.js";
import { exitCodeOf } from "../../../platform/commands/command-failure.js";
import { CommandLine } from "../../../platform/environment/args.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { recordFile } from "../../../domain/serve/__tests__/record-fixtures.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import {
	ExitCodeError,
	ReportedError,
} from "../../../platform/commands/commands.js";

const ROJO_URL = "http://127.0.0.1:34872/api/rojo";

describe("serve command", () => {
	let memFs: MemoryFileSystemService;
	let watcher: MemoryWatcher;
	let processes: MockProcessService;
	let requests: MockRequestService;
	let lifecycle: MockLifecycleService;
	let logService: MockLogService;
	let running: Promise<Result<void, Error>> | undefined;

	const settle = async () => {
		for (let i = 0; i < 20; i++) await jest.advanceTimersByTimeAsync(100);
	};

	const serve = async (
		positionals: string[] = [],
		options: CommandLine["options"] = {},
		passthrough?: string[]
	) => {
		const harness = commandHarness({
			fs: memFs,
			log: logService,
			lifecycle,
			watcher,
			processes,
			requests,
		});
		running = harness.run("serve", {
			positionals,
			options,
			...(passthrough && { passthrough }),
		});
		await settle();
		return running;
	};

	const printed = () =>
		logService.texts("print").map((text) => JSON.parse(text));

	const failureOf = async (result: Promise<Result<void, Error>>) => {
		const settled = await result;
		if (settled.isOk()) throw new Error("expected a failure");
		return settled.error;
	};

	beforeEach(async () => {
		jest.useFakeTimers();
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory("/repo/src");
		await memFs.writeFile("/repo/src/A.luau", "");
		await memFs.writeFile(
			"/repo/rokit.toml",
			'[tools]\nrojo = "rojo-rbx/rojo@7.7.1"\n'
		);
		await memFs.writeFile(
			"/repo/default.rogen.json",
			JSON.stringify({
				rogen: {
					sourcePaths: ["src"],
					routes: { "*": "ReplicatedStorage" },
				},
			})
		);
		watcher = new MemoryWatcher(memFs, new NullLogService());
		processes = new MockProcessService(
			new Map([["rojo", "/bin/rojo"]]),
			new Map([
				["/bin/rojo", { code: 0, stdout: "Rojo 7.7.1", stderr: "" }],
			])
		);
		requests = new MockRequestService();
		lifecycle = new MockLifecycleService();
		logService = new MockLogService();
		running = undefined;
	});

	afterEach(async () => {
		lifecycle.shutdown();
		await settle();
		await running;
		await watcher.stop();
		jest.useRealTimers();
	});

	it("should build, serve, and say when the server answers", async () => {
		void serve();
		await settle();
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});
		await settle();

		expect(logService.lines).toEqual([
			"intro: rogen serve · repo",
			expect.stringMatching(/^step: \d\d:\d\d:\d\d · initial build$/),
			"success: default.project.json · wrote",
			"success: Serving repo with Rojo 7.7.1 at 127.0.0.1:34872.",
		]);
	});

	it("should print the server's banner on stdout as the server printed it, and the rest on stderr", async () => {
		void serve();
		await settle();

		processes.spawned[0].print(
			[
				"Rojo server listening:",
				"  Address: localhost",
				"  Port:    34872",
				"",
				"Visit http://localhost:34872/ in your browser for more information.",
				"",
			].join("\n")
		);
		await settle();

		expect(logService.reserved).toBe(true);
		expect(logService.texts("print")).toEqual([
			"Rojo server listening:",
			"  Address: localhost",
			"  Port:    34872",
			"",
			"Visit http://localhost:34872/ in your browser for more information.",
		]);
	});

	it("should show what the server says as its own lines, besides its banner", async () => {
		void serve();
		await settle();

		processes.spawned[0].printError(
			[
				"[ERROR librojo::change_processor] File is not a valid JSON model: /repo/src/Bad.model.json: JSONC parse error",
				"        ",
				"        Caused by:",
				"            Expected colon on line 2 column 1",
				"[WARN  librojo::snapshot] Unknown file: /repo/src/notes.xyz",
				"",
			].join("\n")
		);
		await settle();

		expect(logService.lines.slice(-2)).toEqual([
			"error: Rojo: File is not a valid JSON model: src/Bad.model.json: JSONC parse error: Expected colon on line 2 column 1",
			"warn: Rojo: Unknown file: src/notes.xyz",
		]);
	});

	it("should stop the server and exit 0 when asked to shut down", async () => {
		const result = serve();
		await settle();

		lifecycle.shutdown();

		expect((await result).isOk()).toBe(true);
		expect(processes.spawned[0].terminated).toBe(true);
		expect(logService.lines.at(-1)).toBe("outro: Stopped serving.");
	});

	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
		["SIGHUP", 129],
	] as const)(
		"should exit with 128 plus the number of %s, which is %i, as the shell reports a Rojo that it stopped",
		async (signal, code) => {
			const result = serve();
			await settle();

			lifecycle.shutdown(signal);

			const ended = await result;
			expect(ended.isErr() && exitCodeOf(ended.error)).toBe(code);
			expect(logService.lines.at(-1)).toBe("outro: Stopped serving.");
		}
	);

	it("should exit 130 for a SIGINT that comes while it prepares", async () => {
		const result = serve();
		lifecycle.shutdown("SIGINT");

		const ended = await result;
		expect(ended.isErr() && exitCodeOf(ended.error)).toBe(130);
		expect(processes.spawned).toEqual([]);
	});

	it("should start nothing when asked to shut down while it prepares", async () => {
		const result = serve();
		lifecycle.shutdown();

		expect((await result).isOk()).toBe(true);
		expect(processes.spawned).toEqual([]);
		expect(await memFs.exists("/repo/default.project.json")).toBe(false);
	});

	it("should exit with the server's code when it stops on its own", async () => {
		const result = serve();
		await settle();

		processes.spawned[0].exit({ code: 3, signal: null });
		const error = await failureOf(result);

		expect(error).toBeInstanceOf(ReportedError);
		expect((error as ReportedError).cause).toBeInstanceOf(ExitCodeError);
		expect(exitCodeOf(error)).toBe(3);
		expect(logService.lines.slice(-2)).toEqual([
			"diagnosticError: /repo/default.rogen.json - error: Rojo stopped serving repo with exit code 3, without saying why. (serve.serverExited)",
			"outro: serve failed.",
		]);
	});

	it("should start nothing and exit 0 when another serve already serves the project", async () => {
		await memFs.writeFile(
			...recordFile(34872, "repo", "/repo/default.project.json")
		);
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});

		const result = await serve();

		expect(result.isOk()).toBe(true);
		expect(processes.spawned).toEqual([]);
		expect(await memFs.exists("/repo/default.project.json")).toBe(false);
		expect(logService.lines).toEqual([
			"intro: rogen serve · repo",
			"info: repo is already served by another rogen serve: Rojo 7.7.1 serves a project named repo at 127.0.0.1:34872 (session s1).",
			"outro: Nothing to start: another rogen serve already serves this project, so nothing is built or watched here.",
		]);
	});

	it("should build for a server no serve started, and exit 0 once it stops answering", async () => {
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});

		const result = serve([], { adopt: true });
		await settle();

		expect(processes.spawned).toEqual([]);
		expect(await memFs.exists("/repo/default.project.json")).toBe(true);
		expect(logService.lines[1]).toBe(
			"info: repo is already served: Rojo 7.7.1 serves a project named repo at 127.0.0.1:34872 (session s1). Rogen builds for it, and stops when it does."
		);

		requests.responses.delete(ROJO_URL);
		await settle();
		await settle();

		expect((await result).isOk()).toBe(true);
		expect(logService.lines.slice(-2)).toEqual([
			"info: Rojo stopped serving repo.",
			"outro: Stopped serving.",
		]);
	});

	it("should mark a server no serve started as adopted, and end with it stopped", async () => {
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});

		void serve([], { json: true, adopt: true });
		await settle();
		requests.responses.delete(ROJO_URL);
		await settle();
		await settle();
		await running;

		expect(printed()).toEqual([
			{
				serving: {
					config: "repo",
					server: "rojo",
					version: "7.7.1",
					project: "repo",
					host: "127.0.0.1",
					port: 34872,
					session: "s1",
					reportsConnections: false,
					alreadyRunning: true,
					adopted: true,
				},
			},
			{ build: expect.objectContaining({ config: "repo" }) },
			{
				stopped: {
					config: "repo",
					server: "rojo",
					reason: "exited",
					adopted: true,
				},
			},
		]);
	});

	it("should print one JSON object per line", async () => {
		void serve([], { json: true });
		await settle();
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});
		await settle();

		expect(printed()).toEqual([
			{
				build: {
					config: "repo",
					file: "/repo/default.rogen.json",
					projectFile: "/repo/default.project.json",
					outcome: "wrote",
					diagnostics: [],
				},
			},
			{
				serving: {
					config: "repo",
					server: "rojo",
					version: "7.7.1",
					project: "repo",
					host: "127.0.0.1",
					port: 34872,
					session: "s1",
					reportsConnections: true,
				},
			},
		]);
		expect(
			logService.entries.filter(({ kind }) => kind !== "print")
		).toEqual([]);
	});

	describe("as Studio connects", () => {
		const websocket = (what: string) =>
			`[DEBUG librojo::web::api] WebSocket subscription ${what}\n`;
		const answered = async (options: CommandLine["options"] = {}) => {
			void serve([], options);
			await settle();
			requests.answer(ROJO_URL, {
				projectName: "repo",
				serverVersion: "7.7.1",
				sessionId: "s1",
			});
			await settle();
		};

		it("should say when Studio connects and leaves", async () => {
			await answered();

			processes.spawned[0].print(websocket("established for session s1"));
			await settle();
			processes.spawned[0].print(websocket("established for session s2"));
			await settle();
			processes.spawned[0].print(websocket("closed by client"));
			await settle();
			processes.spawned[0].print(websocket("closed by client"));
			await settle();

			expect(
				logService.lines.filter((line) => line.includes("Studio"))
			).toEqual([
				"info: Studio connected to repo.",
				"info: Studio connected to repo (2 connected).",
				"info: Studio disconnected from repo, 1 still connected.",
				"info: Studio disconnected from repo.",
			]);
		});

		it("should print each connection as a JSON line, with how many are connected", async () => {
			await answered({ json: true });

			processes.spawned[0].print(websocket("established for session s1"));
			await settle();
			processes.spawned[0].print(websocket("closed by client"));
			await settle();

			expect(printed().slice(2)).toEqual([
				{
					connected: {
						config: "repo",
						server: "rojo",
						project: "repo",
						port: 34872,
						clients: 1,
					},
				},
				{
					disconnected: {
						config: "repo",
						server: "rojo",
						project: "repo",
						port: 34872,
						clients: 0,
					},
				},
			]);
		});

		it("should say on the serving line that this serve reports connections", async () => {
			await answered({ json: true });

			expect(printed()[1].serving).toMatchObject({
				reportsConnections: true,
			});
		});
	});

	it("should print what the server says as JSON lines, without what Rogen drops", async () => {
		void serve([], { json: true });
		await settle();

		processes.spawned[0].print(
			"[INFO  librojo] Listening\n[ERROR librojo] It broke\n"
		);
		await settle();

		expect(printed().filter((line) => "output" in line)).toHaveLength(1);
		expect(printed().at(-1)).toEqual({
			output: {
				config: "repo",
				server: "rojo",
				severity: "error",
				message: "It broke",
			},
		});
	});

	it("should mark the stop of an adopted server as adopted when it was asked to shut down", async () => {
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});
		const result = serve([], { json: true, adopt: true });
		await settle();

		lifecycle.shutdown();
		await result;

		expect(printed().at(-1)).toEqual({
			stopped: {
				config: "repo",
				server: "rojo",
				reason: "shutdown",
				adopted: true,
			},
		});
	});

	it("should mark the stop of an adopted server whose config is gone as adopted, as JSON", async () => {
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});
		void serve([], { json: true, adopt: true });
		await settle();

		await memFs.delete("/repo/default.rogen.json");
		await settle();

		expect(printed().filter((line) => "stopped" in line)).toContainEqual({
			stopped: {
				config: "repo",
				server: "rojo",
				reason: "removed",
				adopted: true,
			},
		});
	});

	it("should say it stopped building for an adopted server whose config is gone, not that the server stopped", async () => {
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});
		void serve([], { adopt: true });
		await settle();

		await memFs.delete("/repo/default.rogen.json");
		await settle();

		expect(logService.lines).toContain(
			"info: Stopped building for repo: its config is gone."
		);
	});

	it("should end the JSON lines with each server stopped on shutdown", async () => {
		const result = serve([], { json: true });
		await settle();

		lifecycle.shutdown();
		await result;

		expect(printed().at(-1)).toEqual({
			stopped: { config: "repo", server: "rojo", reason: "shutdown" },
		});
	});

	describe("as the config changes", () => {
		const writeConfig = async (servePort: number) => {
			await memFs.writeFile(
				"/repo/default.rogen.json",
				JSON.stringify({
					servePort,
					rogen: {
						sourcePaths: ["src"],
						routes: { "*": "ReplicatedStorage" },
					},
				})
			);
			await settle();
		};

		it("should report a port another server holds and go on serving where it is", async () => {
			void serve();
			await settle();
			requests.answer("http://127.0.0.1:34900/api/rojo", {
				projectName: "Other",
				serverVersion: "7.7.1",
			});

			await writeConfig(34900);

			expect(
				logService.lines.some((line) =>
					line.includes("serve.portTaken")
				)
			).toBe(true);
			expect(
				processes.spawned.map(({ terminated }) => terminated)
			).toEqual([false]);
			expect(
				logService.lines.some((line) => line.startsWith("outro:"))
			).toBe(false);
		});

		it("should say a server stopped because its config is gone", async () => {
			const result = serve([], { json: true });
			await settle();

			await memFs.delete("/repo/default.rogen.json");
			await settle();
			lifecycle.shutdown();
			await result;

			expect(
				printed()
					.filter((line) => "stopped" in line)
					.map(({ stopped }) => stopped)
			).toEqual([{ config: "repo", server: "rojo", reason: "removed" }]);
		});

		it("should say a server moved when its config gives it another port", async () => {
			void serve();
			await settle();

			await writeConfig(34901);

			expect(logService.lines).toContainEqual(
				"info: Stopped serving repo at 127.0.0.1:34872: its address changed."
			);
			expect(processes.spawned.map(({ args }) => args)).toEqual([
				["serve", "default.project.json", "--port", "34872"],
				["serve", "default.project.json", "--port", "34901"],
			]);
		});

		it("should end the JSON lines with the server running at shutdown, one moved while serving included", async () => {
			void serve([], { json: true });
			await settle();
			await writeConfig(34901);

			lifecycle.shutdown();
			await running;

			expect(
				printed()
					.filter((line) => "stopped" in line)
					.map(({ stopped }) => [stopped.config, stopped.reason])
			).toEqual([
				["repo", "moved"],
				["repo", "shutdown"],
			]);
		});

		it("should print a refusal as a JSON line of its own", async () => {
			void serve([], { json: true });
			await settle();
			requests.answer("http://127.0.0.1:34900/api/rojo", {
				projectName: "Other",
				serverVersion: "7.7.1",
			});

			await writeConfig(34900);

			expect(printed().at(-1)).toEqual({
				refused: {
					config: "repo",
					server: "rojo",
					diagnostics: [
						expect.objectContaining({ code: "serve.portTaken" }),
					],
				},
			});
		});
	});

	it("should print a config that broke while serving as a notice line", async () => {
		void serve([], { json: true });
		await settle();

		await memFs.writeFile(
			"/repo/default.rogen.json",
			'{"extends": "base"}'
		);
		await settle();

		expect(printed()).toContainEqual({
			notice: expect.objectContaining({
				kind: "broken",
				file: "/repo/default.rogen.json",
				keptLastValid: true,
				diagnostics: [expect.objectContaining({ severity: "error" })],
			}),
		});
	});

	it("should say that rogen serve only starts Rojo when only Argon is pinned, and fail", async () => {
		await memFs.writeFile(
			"/repo/rokit.toml",
			'[tools]\nargon = "argon-rbx/argon@2.0.0"\n'
		);
		processes.installed.clear();

		const error = await failureOf(serve());

		expect(error).toMatchObject({
			diagnostics: [
				expect.objectContaining({
					code: "serve.noServer",
					message: expect.stringContaining(
						"Argon is pinned, but rogen serve only starts Rojo: run 'rogen build --watch' to keep the project files current, and 'argon serve' to serve them."
					),
				}),
			],
		});
		expect(exitCodeOf(error)).toBe(1);
	});

	it("should leave a failure before it served to be reported", async () => {
		processes.installed.clear();

		const error = await failureOf(serve([], { json: true }));

		expect(error).toMatchObject({
			diagnostics: [
				expect.objectContaining({ code: "serve.notInstalled" }),
			],
		});
		expect(exitCodeOf(error)).toBe(1);
		expect(printed()).toEqual([]);
	});

	it("should say why when the watch can't start, before it fails", async () => {
		jest.spyOn(watcher, "watch").mockRejectedValue(new Error("no access"));

		const error = await failureOf(serve());

		expect(error).toBeInstanceOf(ReportedError);
		expect(logService.texts("error")).toEqual(["no access"]);
	});

	it("should print the reason once as JSON when the watch can't start", async () => {
		jest.spyOn(watcher, "watch").mockRejectedValue(new Error("no access"));

		await failureOf(serve([], { json: true }));

		expect(
			printed().filter((line) =>
				(line.error as { message?: string })?.message?.startsWith(
					"no access"
				)
			)
		).toHaveLength(1);
	});

	it("should print a stop as JSON, then the failure", async () => {
		const result = serve([], { json: true });
		await settle();

		processes.spawned[0].exit({ code: 1, signal: null });
		await result;

		expect(printed().slice(1)).toEqual([
			{
				stopped: {
					config: "repo",
					server: "rojo",
					reason: "exited",
					code: 1,
					signal: null,
				},
			},
			{
				diagnostics: [
					expect.objectContaining({ code: "serve.serverExited" }),
				],
			},
		]);
	});

	it("should pass the words after -- to the server", async () => {
		void serve([], {}, ["--port", "40000"]);
		await settle();

		expect(processes.spawned[0].args).toEqual([
			"serve",
			"default.project.json",
			"--port",
			"40000",
		]);
	});

	it("should pass --address, --port and --allowed-hosts to the server before the words after --", async () => {
		void serve(
			[],
			{
				address: "0.0.0.0",
				port: "40000",
				"allowed-hosts": ["studio.local", "pc.lan"],
			},
			["--log-level", "x"]
		);
		await settle();

		expect(processes.spawned[0].args).toEqual([
			"serve",
			"default.project.json",
			"--address",
			"0.0.0.0",
			"--port",
			"40000",
			"--allowed-hosts",
			"studio.local",
			"--allowed-hosts",
			"pc.lan",
			"--log-level",
			"x",
		]);
	});

	it("should refuse a flag given both as an option and after --, starting nothing", async () => {
		const error = await failureOf(
			serve([], { port: "40000" }, ["--port=40001"])
		);

		expect(error.message).toBe(
			"--port is given twice, as an option and after '--'. Give it once."
		);
		expect(processes.spawned).toEqual([]);
	});

	it("should refuse a second project, as Rojo's serve does, starting none", async () => {
		await memFs.writeFile(
			"/repo/lobby/default.rogen.json",
			JSON.stringify({
				rogen: {
					sourcePaths: ["../src"],
					routes: { "*": "Workspace" },
				},
			})
		);

		const error = await failureOf(serve([".", "lobby"]));

		expect(error.message).toContain("unexpected argument 'lobby'");
		expect(processes.spawned).toEqual([]);
	});

	it("should serve the named project, and build only that one", async () => {
		await memFs.writeFile(
			"/repo/lobby/default.rogen.json",
			JSON.stringify({
				rogen: {
					sourcePaths: ["../src"],
					routes: { "*": "Workspace" },
				},
			})
		);

		void serve(["lobby"]);
		await settle();

		expect(processes.spawned[0].args).toEqual([
			"serve",
			"lobby/default.project.json",
			"--port",
			"34872",
		]);
		expect(await memFs.exists("/repo/lobby/default.project.json")).toBe(
			true
		);
		expect(await memFs.exists("/repo/default.project.json")).toBe(false);
		expect(logService.lines[0]).toBe("intro: rogen serve · lobby");
	});

	it("should serve a second place on its own port from a second serve", async () => {
		await memFs.writeFile(
			"/repo/lobby/default.rogen.json",
			JSON.stringify({
				servePort: 40001,
				rogen: {
					sourcePaths: ["../src"],
					routes: { "*": "Workspace" },
				},
			})
		);

		void serve([]);
		await settle();
		void serve(["lobby"], { json: true });
		await settle();

		expect(processes.spawned.map(({ args }) => args)).toEqual([
			["serve", "default.project.json", "--port", "34872"],
			["serve", "lobby/default.project.json", "--port", "40001"],
		]);
	});

	it("should fail with the build's errors and start nothing when the first build fails", async () => {
		await memFs.writeFile(
			"/repo/default.rogen.json",
			JSON.stringify({
				rogen: {
					sourcePaths: ["src"],
					routes: {
						server: "ServerScriptService",
						client: "StarterPlayer/StarterPlayerScripts",
					},
				},
			})
		);
		await memFs.writeFile("/repo/src/X/@server", "");
		await memFs.writeFile("/repo/src/X/@client", "");

		const error = await failureOf(serve());

		expect(exitCodeOf(error)).toBe(1);
		expect(processes.spawned).toEqual([]);
		expect(logService.lines.at(-1)).toBe("outro: serve failed.");
		expect(
			logService.lines.filter((line) =>
				line.includes("route.markerClash")
			)
		).toHaveLength(1);
	});

	it("should end the JSON lines with the build's errors when the first build fails", async () => {
		await memFs.writeFile(
			"/repo/default.rogen.json",
			JSON.stringify({
				rogen: {
					sourcePaths: ["src"],
					routes: {
						server: "ServerScriptService",
						client: "StarterPlayer/StarterPlayerScripts",
					},
				},
			})
		);
		await memFs.writeFile("/repo/src/X/@server", "");
		await memFs.writeFile("/repo/src/X/@client", "");

		const error = await failureOf(serve([], { json: true }));

		expect(exitCodeOf(error)).toBe(1);
		expect(processes.spawned).toEqual([]);
		expect(printed().at(-1)).toEqual({
			diagnostics: [
				expect.objectContaining({ code: "route.markerClash" }),
			],
		});
	});
});
