import { jest } from "@jest/globals";
import { DeferredPromise } from "../../../base/async.js";
import { UsageError, errorKind } from "../../../base/errors.js";
import { Result, ResultError, err, ok } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import {
	MockConfigSelection,
	brokenEntry,
	mockConfig,
	mockEntry,
} from "../../config/__tests__/mock-config-service.js";
import { ConfigSelection, ConfigService } from "../../config/config-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { ConfigChecks } from "../../config/config-checks.js";
import { CoreToolLocator } from "../../toolchain/core-tool-locator.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { ToolLocator } from "../../toolchain/tool-locator.js";
import { ToolchainService } from "../../toolchain/toolchain-service.js";
import { CoreWatchService } from "../../watch/core-watch-service.js";
import { WatchService } from "../../watch/watch-service.js";
import { CoreWriteService } from "../../write/core-write-service.js";
import { WriteService } from "../../write/write-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { SyncDescriptor } from "../../../platform/instantiation/sync-descriptor.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { ProcessService } from "../../../platform/process/process-service.js";
import { MemoryWatcher } from "../../../platform/watcher/memory-watcher.js";
import { Watcher } from "../../../platform/watcher/watcher.js";
import { CoreRojoRunner } from "../core-rojo-runner.js";
import {
	RojoCommandRequest,
	RojoCommandRun,
	RojoRunEnding,
	RojoRunRequest,
} from "../rojo-command-service.js";
import { RojoRunner } from "../rojo-runner.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { CoreRojoCommandService } from "../core-rojo-command-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";

const VERSION = { code: 0, stdout: "Rojo 7.7.1\n", stderr: "" };

describe("CoreRojoCommandService", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;
	let service: CoreRojoCommandService;
	let watcher: MemoryWatcher;

	const selection = () => new MockConfigSelection([mockEntry()]);

	const runOn = (
		chosen: ConfigSelection,
		request: Omit<RojoCommandRequest, "project">
	) =>
		service.runOn(chosen, {
			project: chosen.configs[0] ?? mockConfig(),
			...request,
		});

	const run = (chosen = selection(), flags: string[] = ["-o", "a.rbxl"]) =>
		runOn(chosen, { command: "build", flags, cwd: "/repo" });

	const serviceOf = (
		environment = new MockEnvironmentService("/repo")
	): CoreRojoCommandService =>
		instantiationOf(
			[FileSystemService, fs],
			[EnvironmentService, environment],
			[ProcessService, processes],
			[ToolchainService, new SyncDescriptor(CoreToolchainService)],
			[ToolLocator, new SyncDescriptor(CoreToolLocator)],
			[RojoRunner, new SyncDescriptor(CoreRojoRunner)],
			[
				ConfigService,
				new SyncDescriptor(CoreConfigService, [new ConfigChecks()]),
			],
			[IndexService, new SyncDescriptor(CoreIndexService)],
			[WriteService, new SyncDescriptor(CoreWriteService)],
			[Watcher, watcher],
			[WatchService, new SyncDescriptor(CoreWatchService)]
		).createInstance(CoreRojoCommandService);

	const finish = async (lines: string[], code: number) => {
		await new Promise((resolve) => setImmediate(resolve));
		const [child] = processes.spawned;
		for (const line of lines)
			if (/^(\[?ERROR|error:|\s)/.test(line))
				child.printError(`${line}\n`);
			else child.print(`${line}\n`);
		child.exit({ code, signal: null });
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		processes = new MockProcessService();
		processes.installed.set("rojo", "/bin/rojo");
		processes.outputs.set("/bin/rojo", VERSION);
		watcher = new MemoryWatcher(fs, new NullLogService());
		service = serviceOf();
	});

	it("should run Rojo on the default project, with the flags after its file", async () => {
		const running = run();
		await finish(["Built project to a.rbxl"], 0);

		const ran = (await running).unwrap();

		expect(ran.project.projectFile).toEqual("/repo/default.project.json");
		expect(ran.messages).toEqual([
			{
				severity: "unrecognised",
				text: "Built project to a.rbxl",
				stdout: "Built project to a.rbxl",
			},
		]);
		const [child] = processes.spawned;
		expect(child.file).toEqual("/bin/rojo");
		expect(child.args).toEqual([
			"build",
			"default.project.json",
			"-o",
			"a.rbxl",
		]);
		expect(child.options.cwd).toEqual("/repo");
	});

	describe("Rojo 7.7.0 on Windows", () => {
		beforeEach(async () => {
			processes.outputs.set("/bin/rojo", {
				code: 0,
				stdout: "Rojo 7.7.0\n",
				stderr: "",
			});
			service = serviceOf(
				Object.assign(new MockEnvironmentService("/repo"), {
					isWindows: true,
				})
			);
			await fs.writeFile(
				"/repo/default.project.json",
				JSON.stringify({
					name: "game",
					globIgnorePaths: ["**/*.draft.luau"],
					tree: {
						$className: "Folder",
						Shared: { $path: "../shared" },
					},
				})
			);
		});

		it("should refuse a sourcemap of a file that mounts a folder outside its own", async () => {
			const result = await runOn(selection(), {
				command: "sourcemap",
				flags: [],
				cwd: "/repo",
			});

			expect(result.isErr()).toBe(true);
			expect(processes.spawned).toEqual([]);
		});

		it("should run a build of it, which 7.7.0 reads right", async () => {
			const running = run();
			await finish(["Built project to a.rbxl"], 0);

			expect((await running).isOk()).toBe(true);
		});
	});

	it("should run on the project file the request names, when it is not the project's own", async () => {
		const running = runOn(selection(), {
			command: "syncback",
			flags: ["--input", "a.rbxl"],
			cwd: "/repo",
			projectFile: "/repo/temporary.project.json",
		});
		await finish([], 0);

		await running;

		expect(processes.spawned[0].args).toEqual([
			"syncback",
			"temporary.project.json",
			"--input",
			"a.rbxl",
		]);
	});

	it("should refuse a Rojo older than the release that has the command, and say which", async () => {
		processes.outputs.set("/bin/rojo", {
			code: 0,
			stdout: "Rojo 7.6.1\n",
			stderr: "",
		});

		const refused = await runOn(selection(), {
			command: "syncback",
			flags: [],
			cwd: "/repo",
			since: "7.7.0",
		});

		expect(
			(refused as ResultError<DiagnosticsError>).error.diagnostics
		).toMatchObject([
			{
				code: "rojo.commandUnsupported",
				message:
					"Rojo 7.6.1 has no 'syncback' command. Update Rojo to 7.7.0 or later.",
			},
		]);
		expect(processes.spawned).toEqual([]);
	});

	it("should name the config, not the temporary project file the command runs on, when Rojo is too old", async () => {
		processes.outputs.set("/bin/rojo", {
			code: 0,
			stdout: "Rojo 7.6.1\n",
			stderr: "",
		});

		const refused = await runOn(selection(), {
			command: "syncback",
			flags: [],
			cwd: "/repo",
			since: "7.7.0",
			projectFile: "/repo/temporary.project.json",
		});

		expect(
			(refused as ResultError<DiagnosticsError>).error.diagnostics
		).toMatchObject([{ resource: selection().configs[0].file }]);
	});

	it("should return a run with a failure, and what Rojo said, when it exits with an error", async () => {
		const running = run();
		await finish(["ERROR: could not write a.rbxl"], 1);

		const ran = (await running).unwrap();

		expect(
			(ran.failure as DiagnosticsError | undefined)?.diagnostics[0]
		).toEqual(
			expect.objectContaining({
				code: "rojo.commandFailed",
				resource: "/repo/default.project.json",
				message: "Rojo couldn't build this project:",
				details: ["could not write a.rbxl"],
			})
		);
		expect(ran.messages).toEqual([
			{ severity: "error", text: "could not write a.rbxl" },
		]);
	});

	it("should keep each line Rojo wrote, and each cause, as a detail of its own", async () => {
		const running = run();
		await finish(
			[
				"[ERROR rojo] Unresolvable property in project at path /repo/default.project.json",
				"        ",
				"        Caused by:",
				"            Wrong type of value for property Workspace.Gravity. Expected Float32, got a string",
				"[ERROR rojo] Rojo project referred to a file using $path that could not be turned into a Roblox Instance by Rojo.",
				"        Check that the file exists and is a file type known by Rojo.",
			],
			1
		);

		const ran = (await running).unwrap();

		expect(
			(ran.failure as DiagnosticsError | undefined)?.diagnostics[0]
				.details
		).toEqual([
			"Unresolvable property in project at path /repo/default.project.json",
			"Caused by: Wrong type of value for property Workspace.Gravity. Expected Float32, got a string",
			"Rojo project referred to a file using $path that could not be turned into a Roblox Instance by Rojo.",
			"Check that the file exists and is a file type known by Rojo.",
		]);
	});

	it("should say how Rojo exited when it said nothing", async () => {
		const running = run();
		await finish([], 1);

		const ran = (await running).unwrap();

		expect(
			(ran.failure as DiagnosticsError | undefined)?.diagnostics[0]
		).toMatchObject({
			message: "Rojo couldn't build this project (exit code 1).",
		});
		expect(
			(ran.failure as DiagnosticsError | undefined)?.diagnostics[0]
		).not.toHaveProperty("details");
	});

	it.each([
		[1, "project"],
		[2, "usage"],
	])(
		"should call a Rojo that exits %i a failure of kind %s",
		async (code, kind) => {
			const running = run();
			await finish(["error: invalid value 'abc'"], code);

			expect(errorKind((await running).unwrap().failure!)).toBe(kind);
		}
	);

	it("should say Rojo refused the command line when it exits 2, with every line it printed but the one that points at Rojo's help, and leave none to report beside it", async () => {
		const running = run(selection(), ["--asset_id", "abc"]);
		await new Promise((resolve) => setImmediate(resolve));
		const [child] = processes.spawned;
		child.printError(
			"error: Invalid value \"abc\" for '--asset_id <ASSET_ID>': invalid digit found in string\n\nFor more information try --help\n"
		);
		child.exit({ code: 2, signal: null });

		const ran = (await running).unwrap();

		expect(ran.failure).toEqual(
			new UsageError(
				"Rojo refused the command line:\n  Invalid value \"abc\" for '--asset_id <ASSET_ID>': invalid digit found in string"
			)
		);
		expect(ran.messages).toEqual([]);
	});

	it("should leave out the newer wording of the line that points at Rojo's help", async () => {
		const running = run(selection(), ["--bogus"]);
		await new Promise((resolve) => setImmediate(resolve));
		const [child] = processes.spawned;
		child.printError(
			"error: unexpected argument '--bogus' found\n\nFor more information, try '--help'.\n"
		);
		child.exit({ code: 2, signal: null });

		const ran = (await running).unwrap();

		expect(ran.failure).toEqual(
			new UsageError(
				"Rojo refused the command line:\n  unexpected argument '--bogus' found"
			)
		);
	});

	it("should fail without running Rojo when a config is broken", async () => {
		const broken = new MockConfigSelection([
			brokenEntry([
				errorDiagnostic(
					"config.invalidSyntax",
					{ resource: "/repo/default.rogen.json" },
					"is not JSON."
				),
			]),
		]);

		const result = await run(broken);

		expect(result.isErr()).toBe(true);
		expect(processes.spawned).toEqual([]);
	});

	it("should say why Rojo couldn't be run when the process failed", async () => {
		const running = run();
		await new Promise((resolve) => setImmediate(resolve));
		processes.spawned[0].exit({
			code: null,
			signal: null,
			error: new Error("spawn EACCES"),
		});

		const ran = (await running).unwrap();

		expect(
			(ran.failure as DiagnosticsError | undefined)?.diagnostics[0]
		).toMatchObject({
			message: "Rojo couldn't build this project (spawn EACCES).",
		});
	});

	it("should name a command it has no words for by the command", async () => {
		const running = runOn(selection(), {
			command: "fmt-project",
			flags: [],
			cwd: "/repo",
		});
		await finish([], 1);

		const ran = (await running).unwrap();

		expect(
			(ran.failure as DiagnosticsError | undefined)?.diagnostics[0]
		).toMatchObject({
			message:
				"Rojo couldn't run 'fmt-project' on this project (exit code 1).",
		});
	});

	it("should say how Rojo refused the command line when it said nothing", async () => {
		const running = run();
		await finish([], 2);

		expect((await running).unwrap().failure).toEqual(
			new UsageError("Rojo refused the command line (exit code 2).")
		);
	});

	it("should fail without running Rojo when no Rojo is found", async () => {
		processes.installed.clear();

		const result = await run();

		expect(result.isErr()).toBe(true);
		expect(processes.spawned).toEqual([]);
	});

	it("should not start Rojo when the signal has already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		const result = await runOn(selection(), {
			command: "build",
			flags: [],
			cwd: "/repo",
			signal: controller.signal,
		});

		expect(result.isOk()).toBe(true);
		expect(processes.spawned).toEqual([]);
	});

	it("should call a Rojo that something else interrupted a failure", async () => {
		const running = run();
		await new Promise((resolve) => setImmediate(resolve));
		processes.spawned[0].exit({
			code: 130,
			signal: null,
			interrupted: true,
		});

		expect((await running).unwrap().failure).toBeDefined();
	});

	it("should end Rojo when the signal aborts", async () => {
		const controller = new AbortController();
		const running = runOn(selection(), {
			command: "build",
			flags: [],
			cwd: "/repo",
			signal: controller.signal,
		});
		await new Promise((resolve) => setImmediate(resolve));

		controller.abort();

		expect((await running).isOk()).toBe(true);
		expect(processes.spawned[0].terminated).toBe(true);
	});

	describe("a Rojo run", () => {
		const config = (fields: Record<string, unknown> = {}) =>
			fs.writeFile(
				"/repo/default.rogen.json",
				JSON.stringify({
					sourcePaths: ["src"],
					routes: { "*": "ReplicatedStorage" },
					...fields,
				})
			);

		const request = (
			fields: Partial<RojoRunRequest> = {}
		): RojoRunRequest => ({
			refs: [],
			command: "build",
			flags: ok(["--output=a.rbxl"]),
			cwd: "/repo",
			...fields,
		});

		beforeEach(async () => {
			await fs.createDirectory("/repo/src");
			await config();
		});

		describe("run", () => {
			it("should write the project file, then run Rojo on it", async () => {
				const running = service.run(request());
				await new Promise((resolve) => setTimeout(resolve, 20));
				await finish(["Built project to a.rbxl"], 0);

				const done = (await running).unwrap();

				expect(await fs.exists("/repo/default.project.json")).toBe(
					true
				);
				expect(processes.spawned[0].args).toEqual([
					"build",
					"default.project.json",
					"--output=a.rbxl",
				]);
				expect(done.project?.file).toBe("/repo/default.rogen.json");
				expect(done.home).toBe("/repo");
				expect(done.changed).toBe(true);
				expect(done.failure).toBeUndefined();
			});

			it("should refuse a second project before it reads any config", async () => {
				const result = await service.run(
					request({
						refs: ["a", "b"],
						flags: err(new UsageError("x")),
					})
				);

				expect((result as ResultError<Error>).error.message).toContain(
					"unexpected argument 'b' found: build takes one [PROJECT]."
				);
				expect(await fs.exists("/repo/default.project.json")).toBe(
					false
				);
			});

			it("should refuse flags Rojo can't take before it reads any config", async () => {
				const result = await service.run(
					request({ flags: err(new UsageError("no -o")) })
				);

				expect((result as ResultError<Error>).error.message).toBe(
					"no -o"
				);
				expect(await fs.exists("/repo/default.project.json")).toBe(
					false
				);
			});

			it("should hand back what Rojo prints apart from its messages when the request prints", async () => {
				const running = service.run(
					request({
						command: "sourcemap",
						flags: ok([]),
						prints: true,
					})
				);
				await new Promise((resolve) => setTimeout(resolve, 20));
				await finish(['{"name":"repo"}', "ERROR: odd file"], 0);

				const done = (await running).unwrap();
				const ran = done.ran?.unwrap();

				expect(ran?.printed).toBe('{"name":"repo"}');
				expect(ran?.messages.some(({ stdout }) => stdout)).toBe(false);
			});

			it("should keep what Rojo prints in the messages unless the request prints", async () => {
				const running = service.run(
					request({ command: "sourcemap", flags: ok([]) })
				);
				await new Promise((resolve) => setTimeout(resolve, 20));
				await finish(['{"name":"repo"}'], 0);

				const ran = (await running).unwrap().ran?.unwrap();

				expect(ran?.printed).toBeUndefined();
				expect(ran?.messages).toHaveLength(1);
			});

			it("should name the Rojo run as where a failure came from", async () => {
				const running = service.run(request());
				await new Promise((resolve) => setTimeout(resolve, 20));
				await finish(["ERROR: boom"], 1);

				const { failure } = (await running).unwrap();

				expect(failure?.at).toBe("rojo");
				expect(failure?.error).toBeInstanceOf(DiagnosticsError);
			});

			it("should name the write as where a failure came from, and run no Rojo", async () => {
				await config({ sourcePaths: 3 });

				const { failure } = (await service.run(request())).unwrap();

				expect(failure?.at).toBe("write");
				expect(processes.spawned).toEqual([]);
			});

			it("should run no Rojo when the project has errors", async () => {
				await config({ sourcePaths: 3 });

				const done = (await service.run(request())).unwrap();

				expect(done.project).toBeUndefined();
				expect(done.ran).toBeUndefined();
				expect(processes.spawned).toEqual([]);
			});

			it("should count an upload as no change when the project file was already written", async () => {
				const first = service.run(request());
				await new Promise((resolve) => setTimeout(resolve, 20));
				await finish([], 0);
				await first;

				const uploading = service.run(
					request({ command: "upload", flags: ok(["--asset_id=1"]) })
				);
				await new Promise((resolve) => setTimeout(resolve, 20));
				processes.spawned[1].exit({ code: 0, signal: null });

				expect((await uploading).unwrap().changed).toBe(false);
			});
		});

		describe("watch", () => {
			const settle = async () => {
				await jest.advanceTimersByTimeAsync(250);
				for (let i = 0; i < 10; i++)
					await jest.advanceTimersByTimeAsync(0);
			};

			const watching = async (old = false) => {
				if (old)
					processes.outputs.set("/bin/rojo", {
						code: 0,
						stdout: "Rojo 7.4.0\n",
						stderr: "",
					});
				const watch = (await service.watch(request())).unwrap();
				const runs: Result<RojoCommandRun, Error>[] = [];
				const errors: Error[] = [];
				watch.onDidRun((ran) => runs.push(ran));
				watch.onDidError((error) => errors.push(error));
				const shutdown = new AbortController();
				const ending = watch.run(shutdown.signal);
				await settle();
				return { watch, runs, errors, shutdown, ending };
			};

			const ended = async (
				ending: Promise<Result<RojoRunEnding, Error>>
			) => (await ending).unwrap();

			const rules = { syncRules: [{ pattern: "*.md", use: "text" }] };

			beforeEach(() => jest.useFakeTimers());

			afterEach(() => {
				jest.restoreAllMocks();
				jest.useRealTimers();
			});

			it("should start Rojo's own --watch once the project file is written", async () => {
				const { shutdown, ending, watch } = await watching();

				expect(processes.spawned.map(({ args }) => args)).toEqual([
					[
						"build",
						"default.project.json",
						"--output=a.rbxl",
						"--watch",
					],
				]);
				expect(watch.configs.map(({ file }) => file)).toEqual([
					"/repo/default.rogen.json",
				]);
				shutdown.abort();
				expect(await ended(ending)).toEqual({ kind: "stopped" });
				expect(processes.spawned[0].terminated).toBe(true);
			});

			it("should refuse a project Rojo can't read before it starts Rojo, as Rojo does", async () => {
				await config(rules);

				const { ending } = await watching(true);

				expect(await ended(ending)).toMatchObject({
					kind: "failed",
					error: {
						diagnostics: [{ code: "rojo.syncRulesUnsupported" }],
					},
				});
				expect(processes.spawned).toEqual([]);
			});

			it("should report a project Rojo can't read after it started, and keep Rojo running", async () => {
				const { errors, shutdown, ending } = await watching(true);

				await config(rules);
				await settle();

				expect(errors).toMatchObject([
					{ diagnostics: [{ code: "rojo.syncRulesUnsupported" }] },
				]);
				expect(processes.spawned).toHaveLength(1);
				expect(processes.spawned[0].terminated).toBe(false);
				shutdown.abort();
				await ending;
			});

			it("should report a Rojo it can't find as a failed run, and keep watching", async () => {
				processes.installed.clear();

				const { runs, shutdown, ending } = await watching();

				expect(runs).toHaveLength(1);
				expect(runs[0].isErr()).toBe(true);
				shutdown.abort();
				expect(await ended(ending)).toEqual({ kind: "stopped" });
			});

			it("should end the watch when Rojo stops on its own", async () => {
				const { ending } = await watching();

				processes.spawned[0].printError("ERROR: boom\n");
				processes.spawned[0].exit({ code: 1, signal: null });

				expect((await ended(ending)).kind).toBe("failed");
			});

			it("should keep Rojo running while the project has errors", async () => {
				const { shutdown, ending } = await watching();

				await config({ sourcePaths: 3 });
				await settle();

				expect(processes.spawned).toHaveLength(1);
				expect(processes.spawned[0].terminated).toBe(false);
				shutdown.abort();
				await ending;
			});

			it("should keep Rojo running when another config writes the same project file", async () => {
				const { shutdown, ending } = await watching();

				await fs.delete("/repo/default.rogen.json");
				await fs.writeFile(
					"/repo/default.rogen.jsonc",
					JSON.stringify({
						sourcePaths: ["src"],
						routes: { "*": "ReplicatedStorage" },
					})
				);
				await settle();

				expect(
					processes.spawned.map(({ terminated }) => terminated)
				).toEqual([false]);
				shutdown.abort();
				await ending;
			});

			it("should report no Rojo it can't find once it has stopped", async () => {
				processes.installed.clear();
				const found = new DeferredPromise<void>();
				const find = CoreRojoRunner.prototype.find;
				let finds = 0;
				jest.spyOn(CoreRojoRunner.prototype, "find").mockImplementation(
					async function (this: CoreRojoRunner, ...args) {
						if (finds++ > 0) await found.p;
						return find.apply(this, args);
					}
				);
				const watch = (await service.watch(request())).unwrap();
				const runs: Result<RojoCommandRun, Error>[] = [];
				watch.onDidRun((ran) => runs.push(ran));
				const shutdown = new AbortController();
				const ending = watch.run(shutdown.signal);
				await settle();

				shutdown.abort();
				await settle();
				found.complete();

				expect(await ended(ending)).toEqual({ kind: "stopped" });
				expect(runs).toEqual([]);
			});

			it("should fail when it can't watch the files", async () => {
				jest.spyOn(watcher, "watch").mockRejectedValue(
					new Error("boom")
				);
				const watch = (await service.watch(request())).unwrap();

				const result = await watch.run(new AbortController().signal);

				expect((result as ResultError<Error>).error.message).toBe(
					"boom"
				);
			});

			it("should start nothing when it stops before the first write", async () => {
				const watch = (await service.watch(request())).unwrap();
				const shutdown = new AbortController();
				shutdown.abort();

				expect(await ended(watch.run(shutdown.signal))).toEqual({
					kind: "stopped",
				});
				await settle();
				expect(processes.spawned).toEqual([]);
			});
		});
	});

	describe("runBare", () => {
		const install = () =>
			service.runBare({ args: ["plugin", "install"], cwd: "/repo" });

		it("should run Rojo with the arguments alone, in the folder", async () => {
			const running = install();
			await finish(["Installed Rojo plugin"], 0);

			const ran = (await running).unwrap();

			expect(ran.messages).toEqual([
				{
					severity: "unrecognised",
					text: "Installed Rojo plugin",
					stdout: "Installed Rojo plugin",
				},
			]);
			expect(ran.failure).toBeUndefined();
			expect(processes.spawned[0].file).toEqual("/bin/rojo");
			expect(processes.spawned[0].args).toEqual(["plugin", "install"]);
			expect(processes.spawned[0].options.cwd).toEqual("/repo");
		});

		it("should return a run with a failure that names no file when Rojo exits with an error", async () => {
			const running = install();
			await finish(["ERROR: no plugins folder"], 1);

			const ran = (await running).unwrap();

			expect(ran.failure?.message).toBe(
				"Rojo couldn't run 'rojo plugin install':\n  no plugins folder"
			);
			expect(ran.failure).not.toBeInstanceOf(DiagnosticsError);
		});

		it("should call a Rojo that exits 2 a usage failure", async () => {
			const running = install();
			await finish(["error: unrecognized subcommand"], 2);

			expect(errorKind((await running).unwrap().failure!)).toBe("usage");
		});

		it("should fail without running Rojo when no Rojo is found", async () => {
			processes.installed.clear();

			expect((await install()).isErr()).toBe(true);
			expect(processes.spawned).toEqual([]);
		});
	});
});
