import { jest } from "@jest/globals";
import "../serve-command.js";
import {
	ExitCodeError,
	ReportedError,
	UsageError,
} from "../../../base/errors.js";
import { Result } from "../../../base/result.js";
import { BuildService } from "../../../domain/build/build-service.js";
import { buildServiceOf } from "../../../domain/build/__tests__/fixtures.js";
import { ConfigService } from "../../../domain/config/config-service.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { CoreServeService } from "../../../domain/serve/core-serve-service.js";
import { ServeService } from "../../../domain/serve/serve-service.js";
import { CoreWatchService } from "../../../domain/watch/core-watch-service.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { exitCodeOf } from "../../../platform/commands/command-failure.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { CommandLine } from "../../../platform/environment/args.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { LifecycleService } from "../../../platform/lifecycle/lifecycle-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { LogService } from "../../../platform/log/log-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";

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
		const services = new ServiceCollection();
		const index = new CoreIndexService(memFs);
		const configService = new CoreConfigService(
			memFs,
			new MockEnvironmentService("/repo")
		);
		const buildService = buildServiceOf(memFs, index);
		services.set(LogService, logService);
		services.set(ConfigService, configService);
		services.set(BuildService, buildService);
		services.set(LifecycleService, lifecycle);
		services.set(EnvironmentService, new MockEnvironmentService("/repo"));
		services.set(
			ServeService,
			new CoreServeService(
				configService,
				memFs,
				processes,
				requests,
				new CoreWatchService(watcher, index, buildService),
				new MockEnvironmentService("/repo")
			)
		);
		running = new CoreCommandService(services, logService).executeCommand(
			"serve",
			{ positionals, options, ...(passthrough && { passthrough }) }
		);
		await settle();
		return running;
	};

	const printed = () =>
		logService.entries
			.filter(({ kind }) => kind === "print")
			.map(({ text }) => JSON.parse(text));

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
				rootDirs: ["src"],
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
			"intro: rogen serve · default",
			expect.stringMatching(/^step: \d\d:\d\d:\d\d · initial build$/),
			"success: default.project.json · wrote",
			"success: Serving default with Rojo 7.7.1 at 127.0.0.1:34872.",
		]);
	});

	it("should show what the server says as its own lines, without the server's banner", async () => {
		void serve();
		await settle();

		processes.spawned[0].print(
			[
				"Rojo server listening:",
				"  Address: localhost",
				"  Port:    34872",
				"",
				"Visit http://localhost:34872/ in your browser for more information.",
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
			"diagnosticError: /repo/default.rogen.json - error: Rojo stopped serving default with exit code 3, without saying why. (serve.serverExited)",
			"outro: serve failed.",
		]);
	});

	it("should start nothing and exit 0 when a server already serves the project", async () => {
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
			"intro: rogen serve · default",
			"info: default is already served: Rojo 7.7.1 serves a project named repo at 127.0.0.1:34872 (session s1).",
			"outro: Nothing to start: every config is already served, so nothing is built or watched here.",
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
					config: "default",
					file: "/repo/default.rogen.json",
					outFile: "/repo/default.project.json",
					outcome: "wrote",
					diagnostics: [],
				},
			},
			{
				serving: {
					config: "default",
					tool: "rojo",
					version: "7.7.1",
					project: "repo",
					host: "127.0.0.1",
					port: 34872,
					session: "s1",
				},
			},
		]);
		expect(
			logService.entries.filter(({ kind }) => kind !== "print")
		).toEqual([]);
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
				config: "default",
				tool: "rojo",
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
			stopped: { config: "default", tool: "rojo", reason: "shutdown" },
		});
	});

	it("should print a failure as one JSON line", async () => {
		processes.installed.clear();

		const result = await serve([], { json: true });

		expect(exitCodeOf((result as { error: Error }).error)).toBe(1);
		expect(printed()).toEqual([
			{
				diagnostics: [
					expect.objectContaining({ code: "serve.notInstalled" }),
				],
			},
		]);
	});

	it("should print a stop as JSON, then the failure", async () => {
		const result = serve([], { json: true });
		await settle();

		processes.spawned[0].exit({ code: 1, signal: null });
		await result;

		expect(printed().slice(1)).toEqual([
			{
				stopped: {
					config: "default",
					tool: "rojo",
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

	it("should refuse a server it doesn't know", async () => {
		const error = await failureOf(serve([], { tool: "lune" }));

		expect((error as ReportedError).cause).toEqual(
			new UsageError('--tool takes rojo or argon, not "lune".')
		);
		expect(exitCodeOf(error)).toBe(2);
	});

	it("should serve a named config and still build every config here", async () => {
		await memFs.writeFile(
			"/repo/sync.rogen.json",
			JSON.stringify({
				extends: "./default.rogen.json",
				outFile: "sync.project.json",
			})
		);

		void serve(["default"]);
		await settle();

		expect(processes.spawned[0].args).toEqual([
			"serve",
			"default.project.json",
		]);
		expect(await memFs.exists("/repo/sync.project.json")).toBe(true);
	});

	it("should fail with the build's errors and start nothing when the first build fails", async () => {
		await memFs.writeFile(
			"/repo/default.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes: {
					server: "ServerScriptService",
					client: "StarterPlayer/StarterPlayerScripts",
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
});
