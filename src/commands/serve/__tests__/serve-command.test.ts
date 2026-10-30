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
import { LogLevel } from "../../../platform/log/log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { recordFile } from "../../../domain/serve/__tests__/record-fixtures.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { ReportedError } from "../../../platform/commands/commands.js";

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
		options: CommandLine["options"] = {}
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
				sourcePaths: ["src"],
				routes: { "*": "ReplicatedStorage" },
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

	it("should write, serve, and say when the server answers", async () => {
		void serve();
		await settle();
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});
		await settle();

		expect(logService.lines).toEqual([
			"intro: rogen serve · default.rogen.json",
			expect.stringMatching(/^step: \d\d:\d\d:\d\d · initial write$/),
			"success: Wrote default.project.json.",
			"success: Serving repo at localhost:34872 · http://localhost:34872/\n  In Studio, press Connect in the Rojo plugin.",
		]);
		expect(logService.reserved).toBe(false);
	});

	it("should name the Rojo that serves only with --verbose", async () => {
		logService.setLevel(LogLevel.Debug);
		void serve();
		await settle();
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});
		await settle();

		expect(logService.lines).toContain(
			"debug: Rojo 7.7.1 serves repo (session s1)."
		);
	});

	it("should say nothing of a change that leaves the project file as it was", async () => {
		void serve();
		await settle();
		logService.clear();

		await memFs.writeFile("/repo/src/A.luau", "print()");
		await settle();

		expect(logService.lines).toEqual([]);
	});

	it("should say nothing of an initial write that leaves the project file as it was", async () => {
		void serve();
		await settle();
		lifecycle.shutdown();
		await settle();
		await running;
		logService.clear();
		lifecycle = new MockLifecycleService();

		void serve();
		await settle();

		expect(logService.lines).toEqual([
			"intro: rogen serve · default.rogen.json",
		]);
	});

	it("should still say a change that rewrites the project file", async () => {
		void serve();
		await settle();
		logService.clear();

		await memFs.writeFile(
			"/repo/default.rogen.json",
			JSON.stringify({
				sourcePaths: ["src"],
				routes: { "*": "ServerStorage" },
			})
		);
		await settle();

		expect(logService.lines).toEqual([
			expect.stringMatching(
				/^step: \d\d:\d\d:\d\d · default\.rogen\.json changed · reloaded$/
			),
			"success: Wrote default.project.json.",
		]);
	});

	it("should drop the server's banner, since the Serving line says where it listens", async () => {
		void serve();
		await settle();
		logService.clear();

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

		expect(logService.lines).toEqual([]);
	});

	it("should say Rojo's warning that the network reaches the server as one warning", async () => {
		void serve([], { address: "0.0.0.0" });
		await settle();
		logService.clear();

		processes.spawned[0].print(
			[
				"Rojo server listening:",
				"  Address: \u001b[0m\u001b[1m\u001b[32m0.0.0.0",
				"\u001b[0m  Port:    \u001b[0m\u001b[1m\u001b[32m34872",
				"",
				"\u001b[0m\u001b[1m\u001b[33mWARNING: This server is bound to 0.0.0.0, which is reachable from the network.",
				"The serve API is unauthenticated, so anyone who can reach 0.0.0.0:34872 can read",
				"and modify your project's source.",
				"\u001b[0m",
				"\u001b[0mVisit \u001b[0m\u001b[1m\u001b[32mhttp://0.0.0.0:34872/\u001b[0m in your browser for more information.",
				"",
			].join("\n")
		);
		await settle();

		expect(logService.lines).toEqual([
			"warn: Rojo: This server is bound to 0.0.0.0, which is reachable from the network. The serve API is unauthenticated, so anyone who can reach 0.0.0.0:34872 can read and modify your project's source.",
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
			"error: Rojo: File is not a valid JSON model: src/Bad.model.json: JSONC parse error\n  Caused by: Expected colon on line 2 column 1",
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

	it("should exit 1 when the server stops on its own with an error", async () => {
		const result = serve();
		await settle();

		processes.spawned[0].exit({ code: 3, signal: null });
		const error = await failureOf(result);

		expect(error).toBeInstanceOf(ReportedError);
		expect(exitCodeOf(error)).toBe(1);
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
			"intro: rogen serve · default.rogen.json",
			"info: default.rogen.json is already served by another rogen serve: Rojo 7.7.1 serves a project named repo at localhost:34872 (session s1).",
			"outro: Nothing to start: another rogen serve already serves this project, so nothing is written or watched here.",
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
				write: {
					config: "default.rogen.json",
					projectFile: "/repo/default.project.json",
					outcome: "wrote",
					diagnostics: [],
				},
			},
			{
				serving: {
					config: "default.rogen.json",
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
				logService.lines.filter((line) =>
					line.startsWith("info: Studio")
				)
			).toEqual([
				"info: Studio connected to default.rogen.json.",
				"info: Studio connected to default.rogen.json (2 connected).",
				"info: Studio disconnected from default.rogen.json, 1 still connected.",
				"info: Studio disconnected from default.rogen.json.",
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
						config: "default.rogen.json",
						project: "repo",
						port: 34872,
						clients: 1,
					},
				},
				{
					disconnected: {
						config: "default.rogen.json",
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
				config: "default.rogen.json",
				severity: "error",
				message: "It broke",
			},
		});
	});

	it("should end the JSON lines with each server stopped on shutdown", async () => {
		const result = serve([], { json: true });
		await settle();

		lifecycle.shutdown();
		await result;

		expect(printed().at(-1)).toEqual({
			stopped: { config: "default.rogen.json", reason: "shutdown" },
		});
	});

	describe("as the config changes", () => {
		const writeConfig = async (servePort: number) => {
			await memFs.writeFile(
				"/repo/default.rogen.json",
				JSON.stringify({
					servePort,
					sourcePaths: ["src"],
					routes: { "*": "ReplicatedStorage" },
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
			).toEqual([{ config: "default.rogen.json", reason: "removed" }]);
		});

		it("should say a server moved when its config gives it another port", async () => {
			void serve();
			await settle();

			await writeConfig(34901);

			expect(logService.lines).toContainEqual(
				"info: Stopped serving default.rogen.json at localhost:34872: its address changed."
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
				["default.rogen.json", "moved"],
				["default.rogen.json", "shutdown"],
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
					config: "default.rogen.json",
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
				config: "default.rogen.json",
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
					code: "rojo.notFound",
					message: expect.stringContaining(
						"Argon is pinned, but rogen serve only starts Rojo: run 'rogen write --watch' to keep the project files current, and 'argon serve' to serve them."
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
				expect.objectContaining({ code: "rojo.notInstalled" }),
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
					config: "default.rogen.json",
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

	describe("when Rojo crashes", () => {
		const crashText =
			"[ERROR rojo] Rojo crashed! You are running Rojo 7.7.1.\n[ERROR rojo] Details: it broke\n";
		const answer = async (session: string) => {
			requests.answer(ROJO_URL, {
				projectName: "repo",
				serverVersion: "7.7.1",
				sessionId: session,
			});
			await settle();
		};
		const crash = async (index: number) => {
			requests.responses.delete(ROJO_URL);
			processes.spawned[index].printError(crashText);
			processes.spawned[index].exit({ code: 1, signal: null });
			await settle();
		};

		it("should restart it, say to press Connect, and keep serving", async () => {
			void serve();
			await settle();
			await answer("s1");

			await crash(0);
			await answer("s2");

			expect(processes.spawned).toHaveLength(2);
			expect(logService.lines.slice(-1)).toEqual([
				"info: Rojo crashed, so Rogen restarted it on localhost:34872.\n  In Studio, press Connect in the Rojo plugin.",
			]);
			expect(logService.lines.join("\n")).not.toContain("error");
		});

		it("should exit 1 with Rojo's crash text when it crashes again right after the restart", async () => {
			const result = serve();
			await settle();
			await answer("s1");
			await crash(0);
			await answer("s2");

			await crash(1);
			const error = await failureOf(result);

			expect(exitCodeOf(error)).toBe(1);
			expect(logService.lines.slice(-2)).toEqual([
				[
					"diagnosticError: /repo/default.rogen.json - error: Rojo crashed again right after a restart, so Rogen stopped serving repo: (rojo.crashed)",
					"  Rojo crashed! You are running Rojo 7.7.1.",
					"  Details: it broke",
				].join("\n"),
				"outro: serve failed.",
			]);
		});

		it("should print the restart and the giving up as JSON lines", async () => {
			const result = serve([], { json: true });
			await settle();
			await answer("s1");
			await crash(0);
			await answer("s2");

			await crash(1);
			await result;

			expect(printed().slice(2)).toEqual([
				{
					restarted: {
						config: "default.rogen.json",
						version: "7.7.1",
						project: "repo",
						host: "127.0.0.1",
						port: 34872,
						session: "s2",
						code: 1,
					},
				},
				{
					stopped: {
						config: "default.rogen.json",
						reason: "crashed",
						code: 1,
						signal: null,
					},
				},
				{
					diagnostics: [
						expect.objectContaining({
							code: "rojo.crashed",
							details: [
								"Rojo crashed! You are running Rojo 7.7.1.",
								"Details: it broke",
							],
						}),
					],
				},
			]);
		});
	});

	it("should pass --address, --port and --allowed-hosts to the server", async () => {
		void serve([], {
			address: "0.0.0.0",
			port: "40000",
			"allowed-hosts": ["studio.local", "pc.lan"],
		});
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
		]);
	});

	it("should refuse a second project, as Rojo's serve does, starting none", async () => {
		await memFs.writeFile(
			"/repo/lobby/default.rogen.json",
			JSON.stringify({
				sourcePaths: ["../src"],
				routes: { "*": "Workspace" },
			})
		);

		const error = await failureOf(serve([".", "lobby"]));

		expect(error.message).toContain("unexpected argument 'lobby'");
		expect(processes.spawned).toEqual([]);
	});

	it("should serve the named project, and write only that one", async () => {
		await memFs.writeFile(
			"/repo/lobby/default.rogen.json",
			JSON.stringify({
				sourcePaths: ["../src"],
				routes: { "*": "Workspace" },
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
		expect(logService.lines[0]).toBe(
			"intro: rogen serve · lobby/default.rogen.json"
		);
	});

	it("should serve a second place on its own port from a second serve", async () => {
		await memFs.writeFile(
			"/repo/lobby/default.rogen.json",
			JSON.stringify({
				servePort: 40001,
				sourcePaths: ["../src"],
				routes: { "*": "Workspace" },
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

	const clashing = async () => {
		await memFs.writeFile(
			"/repo/default.rogen.json",
			JSON.stringify({
				sourcePaths: ["src"],
				routes: {
					server: "ServerScriptService",
					client: "StarterPlayer/StarterPlayerScripts",
				},
			})
		);
		await memFs.writeFile("/repo/src/X/@server", "");
		await memFs.writeFile("/repo/src/X/@client", "");
	};

	it("should print the write's errors once, start nothing and keep watching when the first write fails", async () => {
		await clashing();

		const result = serve();
		await settle();

		expect(processes.spawned).toEqual([]);
		expect(
			logService.lines.filter((line) =>
				line.includes("route.markerClash")
			)
		).toHaveLength(1);
		expect(logService.lines.at(-1)).not.toMatch(/^outro/);

		lifecycle.shutdown();
		expect((await result).isOk()).toBe(true);
	});

	it("should exit 1 at once, starting nothing, when the config does not load", async () => {
		await memFs.writeFile("/repo/default.rogen.json", "{ nope");

		const error = await failureOf(serve());

		expect(exitCodeOf(error)).toBe(1);
		expect(processes.spawned).toEqual([]);
	});

	it("should serve once a later write succeeds", async () => {
		await clashing();
		void serve();
		await settle();

		await memFs.delete("/repo/src/X/@client");
		await settle();
		requests.answer(ROJO_URL, {
			projectName: "repo",
			serverVersion: "7.7.1",
			sessionId: "s1",
		});
		await settle();

		expect(processes.spawned).toHaveLength(1);
		expect(logService.lines.at(-1)).toBe(
			"success: Serving repo at localhost:34872 · http://localhost:34872/\n  In Studio, press Connect in the Rojo plugin."
		);
	});

	it("should print the write's errors once as JSON lines and wait for a fix when the first write fails", async () => {
		await clashing();

		void serve([], { json: true });
		await settle();

		expect(processes.spawned).toEqual([]);
		expect(
			printed().filter((line) =>
				JSON.stringify(line).includes("route.markerClash")
			)
		).toHaveLength(1);
		expect(printed().some((line) => "serving" in line)).toBe(false);
	});
});
