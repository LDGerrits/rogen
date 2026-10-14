import path from "path";
import { jest } from "@jest/globals";
import "../build-command.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import { ResultError } from "../../../base/result.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import {
	MockConfigService,
	brokenEntry,
	mockEntry,
} from "../../../domain/config/__tests__/mock-config-service.js";
import { ResolvedConfigSpec } from "../../../domain/config/__tests__/mock-config-service.js";
import { CommandLine, parseArgs } from "../../../platform/environment/args.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";

import { LogService } from "../../../platform/log/log-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import {
	CommandRegistry,
	Extensions,
	ReportedError,
} from "../../../platform/commands/commands.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { Registry } from "../../../platform/registry/registry.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

describe("build command", () => {
	let fs: MemoryFileSystemService;

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
	});

	const run = async (
		config: MockConfigService,
		log: LogService,
		line: CommandLine = { positionals: [], options: {} },
		index?: IndexService
	) => commandHarness({ fs, log, config, index }).run("build", line);

	const buildable = (overrides: ResolvedConfigSpec = {}, folder = "") =>
		mockEntry(
			{
				name: folder || "repo",
				sourcePaths: [abs(folder, "src")],
				routes: { "*": "ReplicatedStorage" },
				...overrides,
			},
			abs(folder, "rogen.json")
		);

	it("should write the project file for a config", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const logService = new NullLogService();
		const success = jest.spyOn(logService, "success");

		const result = await run(
			new MockConfigService([buildable()]),
			logService
		);

		expect(result.isOk()).toBe(true);
		expect(
			JSON.parse(await fs.readFile(abs("default.project.json")))
		).toMatchObject({
			tree: {
				ReplicatedStorage: {
					A: { $path: { optional: "src/A.luau" } },
				},
			},
		});
		expect(success).toHaveBeenCalledWith("default.project.json · wrote");
	});

	describe("with projects", () => {
		const write = (file: string, content: unknown) =>
			fs.writeFile(abs(file), JSON.stringify(content));

		const files = async () =>
			Object.fromEntries(
				await Promise.all(
					["default", "dist", "release"].map(async (stem) => {
						const file = abs(`${stem}.project.json`);
						return [
							stem,
							(await fs.exists(file))
								? JSON.parse(await fs.readFile(file))
								: undefined,
						] as const;
					})
				)
			);

		beforeEach(async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			await fs.writeFile(abs("dev/B.luau"), "");
			await write("rogen.json", {
				routes: { "*": "ReplicatedStorage" },
				tree: { $className: "DataModel" },
				projects: {
					dist: { syncPath: "dist" },
					release: { sourcePaths: ["src", "dev"] },
				},
			});
		});

		it("should write a project file for the description and each project, each from its own source paths", async () => {
			const { run } = commandHarness({ fs });

			expect((await run("build")).isOk()).toBe(true);

			const written = await files();
			const children = (stem: string) =>
				Object.keys(written[stem].tree.ReplicatedStorage).filter(
					(key) => !key.startsWith("$")
				);
			expect(children("default")).toEqual(["A"]);
			expect(children("release")).toEqual(["A", "B"]);
			expect(written.dist.tree.ReplicatedStorage.A).toEqual({
				$path: { optional: "dist/A.luau" },
			});
		});

		it("should leave the name off the description and give every project one", async () => {
			const { run } = commandHarness({ fs });

			await run("build");

			const written = await files();
			expect(written.default).not.toHaveProperty("name");
			expect(written.dist.name).toBe("repo");
			expect(written.release.name).toBe("repo");
		});

		it("should write every project when one is named", async () => {
			const { run } = commandHarness({ fs });

			expect(
				(
					await run("build", { positionals: ["dist"], options: {} })
				).isOk()
			).toBe(true);

			const written = await files();
			expect(
				Object.keys(written).filter((stem) => written[stem])
			).toEqual(["default", "dist", "release"]);
		});

		it("should fail naming the projects there are when the name is none of them", async () => {
			const { run } = commandHarness({ fs });

			const result = await run("build", {
				positionals: ["nope"],
				options: {},
			});

			expect((result as ResultError<Error>).error.message).toBe(
				'No project "nope" in rogen.json, which has "default", "dist" and "release". Name a folder with a rogen.json, a *.project.json path, or one of them.'
			);
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});

		it("should write none of them when one fails to build", async () => {
			await fs.writeFile(abs("bad/Combat/A.luau"), "");
			await fs.writeFile(abs("bad/Combat/init.meta.json"), '{"id": 1}');
			await write("rogen.json", {
				routes: { "*": "ReplicatedStorage" },
				projects: { dist: { sourcePaths: ["bad"] } },
			});
			const { run } = commandHarness({ fs });

			const result = await run("build");

			expect(result.isErr()).toBe(true);
			expect(await files()).toEqual({
				default: undefined,
				dist: undefined,
				release: undefined,
			});
		});
	});

	it("should write one file per config from a shared scan", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const readDirectory = jest.spyOn(fs, "readDirectory");

		const result = await run(
			new MockConfigService([
				buildable({ sourcePaths: [abs("src")] }, "lobby"),
				buildable({ sourcePaths: [abs("src")] }, "arena"),
			]),
			new NullLogService(),
			{ positionals: [], options: {} }
		);

		expect(result.isOk()).toBe(true);
		expect(
			readDirectory.mock.calls.filter(([dir]) => dir === abs("src"))
		).toHaveLength(1);
		expect(await fs.exists(abs("lobby/default.project.json"))).toBe(true);
		expect(await fs.exists(abs("arena/default.project.json"))).toBe(true);
	});

	it("should open with a header, group each config in a step and close with a result", async () => {
		await fs.writeFile(abs("lobby/src/A.luau"), "");
		await fs.writeFile(abs("arena/src/A.luau"), "");
		const logService = new MockLogService();

		await run(
			new MockConfigService([
				buildable({}, "lobby"),
				buildable({}, "arena"),
			]),
			logService
		);

		expect(logService.lines).toEqual([
			"intro: rogen build · lobby, arena",
			"step: lobby",
			"success: lobby/default.project.json · wrote",
			"step: arena",
			"success: arena/default.project.json · wrote",
			expect.stringMatching(/^outro: /),
		]);
	});

	it("should print a warning after the result of its config", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const logService = new MockLogService();

		await run(
			new MockConfigService([
				buildable({ routes: { server: "ServerScriptService" } }),
			]),
			logService
		);

		expect(logService.entries.map(({ kind }) => kind)).toEqual([
			"intro",
			"success",
			"diagnosticWarning",
			"outro",
		]);
	});

	it("should write the tree of a config that declares no routes", async () => {
		const logService = new MockLogService();

		const result = await run(
			new MockConfigService([
				buildable({
					sourcePaths: [],
					routes: {},
					project: {
						tree: {
							$className: "DataModel",
							Workspace: { $className: "Workspace" },
						},
					},
				}),
			]),
			logService
		);

		expect(result.isOk()).toBe(true);
		expect(
			JSON.parse(await fs.readFile(abs("default.project.json")))
		).toMatchObject({
			tree: { Workspace: { $className: "Workspace" } },
		});
		expect(logService.lines).toEqual([
			"intro: rogen build · repo",
			"success: default.project.json · wrote",
			expect.stringMatching(/^outro: /),
		]);
	});

	it("should report an invalid folder meta once when two configs read it, and write nothing", async () => {
		await fs.writeFile(abs("src/Combat/A.luau"), "");
		await fs.writeFile(abs("src/Combat/init.meta.json"), '{"id": 1}');

		const result = await run(
			new MockConfigService([
				buildable({ sourcePaths: [abs("src")] }, "lobby"),
				buildable({ sourcePaths: [abs("src")] }, "arena"),
			]),
			new NullLogService()
		);

		const message = (result as ResultError<Error>).error.message;
		expect(message.match(/init\.meta\.json/g)).toHaveLength(1);
		expect(message).toContain('"id": expected a string, found a number.');
		expect(await fs.exists(abs("lobby/default.project.json"))).toBe(false);
	});

	it("should still print the sync path warning of a config when another fails to build", async () => {
		await fs.writeFile(abs("lobby/src/A.luau"), "");
		await fs.writeFile(abs("bad/src/Combat/A.luau"), "");
		await fs.writeFile(abs("bad/src/Combat/init.meta.json"), '{"id": 1}');
		const logService = new NullLogService();
		const diagnostic = jest.spyOn(logService, "diagnostic");

		const result = await run(
			new MockConfigService([
				buildable({ syncPath: abs("lobby/out") }, "lobby"),
				buildable({}, "bad"),
			]),
			logService
		);

		expect(result.isErr()).toBe(true);
		expect(diagnostic.mock.calls).toMatchObject([
			[{ message: expect.stringContaining("doesn't exist yet") }, false],
			[{ code: "meta.wrongType" }, false],
		]);
	});

	it("should name each config it didn't write, as watch does", async () => {
		await fs.writeFile(abs("lobby/src/A.luau"), "");
		await fs.writeFile(abs("bad/src/Combat/A.luau"), "");
		await fs.writeFile(abs("bad/src/Combat/init.meta.json"), '{"id": 1}');
		const logService = new NullLogService();
		const error = jest.spyOn(logService, "error");

		await run(
			new MockConfigService([
				buildable({}, "lobby"),
				buildable({}, "bad"),
			]),
			logService
		);

		expect(error.mock.calls).toEqual([
			["lobby/default.project.json · not written · bad failed"],
			["bad/default.project.json · not written"],
		]);
	});

	it("should fail when the project file cannot be written", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		await fs.createDirectory(abs("default.project.json"));

		const result = await run(
			new MockConfigService([buildable()]),
			new NullLogService()
		);

		expect((result as ResultError<Error>).error.message).toContain(
			"could not be written"
		);
	});

	describe("on GitHub Actions", () => {
		const annotatedRun = async (
			entries: ReturnType<typeof buildable>[],
			line: CommandLine = { positionals: [], options: {} }
		) => {
			const logService = new MockLogService("/repo", "/repo");
			const result = await commandHarness({
				fs,
				log: logService,
				config: new MockConfigService(entries),
			}).run("build", line);
			return { logService, result };
		};

		it("should annotate every warning of a build, though the text lists only some of them", async () => {
			for (let i = 1; i <= 12; i++)
				await fs.writeFile(abs(`src/F${i}@sever.luau`), "");

			const { logService } = await annotatedRun([
				buildable({
					routes: {
						"*": "ReplicatedStorage",
						Server: "ServerScriptService",
					},
				}),
			]);

			expect(logService.texts("annotation")).toHaveLength(12);
			expect(logService.texts("annotation")).toContain(
				'::warning file=src/F9@sever.luau,title=route.strayAt::did you mean "@Server"?'
			);
			expect(
				logService.texts("diagnosticWarning").join("\n")
			).not.toContain("F9@sever");
		});

		it("should annotate an error that fails the build", async () => {
			await fs.writeFile(abs("src/Combat/A.luau"), "");
			await fs.writeFile(abs("src/Combat/init.meta.json"), '{"id": 1}');

			const { logService } = await annotatedRun([buildable()]);

			expect(logService.texts("annotation")).toEqual([
				'::error file=src/Combat/init.meta.json,line=1,col=8,title=meta.wrongType::"id": expected a string, found a number.',
			]);
		});
	});

	it("should report a config that doesn't load as part of the build, and fail", async () => {
		const logService = new MockLogService();
		const entry = brokenEntry([
			errorDiagnostic(
				"config.removedField",
				{ resource: "/repo/rogen.json" },
				"boom."
			),
		]);

		const result = await run(new MockConfigService([entry]), logService);

		expect(result.isErr() && result.error).toBeInstanceOf(ReportedError);
		expect(logService.lines).toEqual([
			"intro: rogen build · repo",
			"error: rogen.json · not loaded",
			"diagnosticError: /repo/rogen.json - error: boom. (config.removedField)",
			expect.stringMatching(/^outro: .*fail/),
		]);
	});

	describe("--deny-warnings", () => {
		const withWarning = async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			return new MockConfigService([
				buildable({ routes: { server: "ServerScriptService" } }),
			]);
		};

		it("should exit 1 on a warning, and still write the project file", async () => {
			const logService = new MockLogService();

			const result = await run(await withWarning(), logService, {
				positionals: [],
				options: { "deny-warnings": true },
			});

			expect(result.isErr() && result.error).toBeInstanceOf(
				ReportedError
			);
			expect(await fs.exists(abs("default.project.json"))).toBe(true);
			expect(logService.lines.at(-1)).toMatch(
				/1 warning.*--deny-warnings/
			);
		});

		it("should exit 0 on a warning without the flag", async () => {
			const logService = new MockLogService();

			const result = await run(await withWarning(), logService);

			expect(result.isOk()).toBe(true);
			expect(logService.lines.at(-1)).toMatch(/1 warning/);
			expect(logService.lines.at(-1)).not.toContain("--deny-warnings");
		});

		it("should exit 0 with the flag when there is no warning", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const logService = new MockLogService();

			const result = await run(
				new MockConfigService([buildable()]),
				logService,
				{ positionals: [], options: { "deny-warnings": true } }
			);

			expect(result.isOk()).toBe(true);
			expect(logService.lines.at(-1)).not.toMatch(/warning/);
		});

		it("should still fail on errors", async () => {
			const result = await run(
				new MockConfigService([
					brokenEntry([
						errorDiagnostic(
							"config.removedField",
							{ resource: "/repo/rogen.json" },
							"boom."
						),
					]),
				]),
				new MockLogService(),
				{ positionals: [], options: { "deny-warnings": true } }
			);

			expect(result.isErr()).toBe(true);
		});

		it("should exit 1 with --json and keep the warning's severity and code", async () => {
			const logService = new MockLogService();

			const result = await run(await withWarning(), logService, {
				positionals: [],
				options: { json: true, "deny-warnings": true },
			});

			expect(result.isErr() && result.error).toBeInstanceOf(
				ReportedError
			);
			const document = logService.json<{
				configs: { diagnostics: unknown[] }[];
			}>();
			expect(document.configs[0].diagnostics).toEqual([
				expect.objectContaining({
					severity: "warning",
					code: "route.unrouted",
				}),
			]);
		});
	});

	describe("--json", () => {
		const buildJson = async (
			configService: MockConfigService,
			logService = new MockLogService()
		) => {
			const result = await run(configService, logService, {
				positionals: [],
				options: { json: true },
			});
			return {
				result,
				logService,
				document:
					logService.texts("print").length === 0
						? undefined
						: logService.json(),
			};
		};

		it("should list a warning several configs share under each of them", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const routes = { server: "ServerScriptService" };

			const { document } = await buildJson(
				new MockConfigService([
					buildable({ routes, sourcePaths: [abs("src")] }, "lobby"),
					buildable({ routes, sourcePaths: [abs("src")] }, "arena"),
				])
			);

			const codes = document.configs.map(
				({ diagnostics }: { diagnostics: { code: string }[] }) =>
					diagnostics.map(({ code }) => code)
			);
			expect(codes[0]).toHaveLength(1);
			expect(codes[1]).toEqual(codes[0]);
		});

		it("should print what each config wrote", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const { result, document } = await buildJson(
				new MockConfigService([buildable()])
			);

			expect(result.isOk()).toBe(true);
			expect(document).toEqual({
				configs: [
					{
						config: "repo",
						file: "/repo/rogen.json",
						projectFile: "/repo/default.project.json",
						outcome: "wrote",
						diagnostics: [],
					},
				],
			});
			expect(await fs.exists(abs("default.project.json"))).toBe(true);
		});

		it("should say unchanged for a project file that was already up to date", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			await run(
				new MockConfigService([buildable()]),
				new NullLogService()
			);

			const { document } = await buildJson(
				new MockConfigService([buildable()])
			);

			expect(document.configs[0].outcome).toBe("unchanged");
		});

		it("should list a config's warnings with their codes", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const { result, document } = await buildJson(
				new MockConfigService([
					buildable({ routes: { server: "ServerScriptService" } }),
				])
			);

			expect(result.isOk()).toBe(true);
			expect(document.configs[0].outcome).toBe("wrote");
			expect(document.configs[0].diagnostics).toEqual([
				expect.objectContaining({
					file: abs("src/A.luau"),
					severity: "warning",
					code: expect.any(String),
					message: expect.stringContaining("matched no route"),
				}),
			]);
		});

		it("should print every config as not written, with its errors, and fail without reporting again", async () => {
			await fs.writeFile(abs("lobby/src/Combat/A.luau"), "");
			await fs.writeFile(
				abs("lobby/src/Combat/init.meta.json"),
				'{"id": 1}'
			);
			await fs.writeFile(abs("arena/src/B.luau"), "");

			const { result, document } = await buildJson(
				new MockConfigService([
					buildable({}, "lobby"),
					buildable({}, "arena"),
				])
			);

			expect(
				document.configs.map(
					({ file, outcome }: Record<string, string>) => [
						file,
						outcome,
					]
				)
			).toEqual([
				["/repo/lobby/rogen.json", "notWritten"],
				["/repo/arena/rogen.json", "notWritten"],
			]);
			expect(document.configs[0].diagnostics).toEqual([
				expect.objectContaining({
					file: abs("lobby/src/Combat/init.meta.json"),
					severity: "error",
				}),
			]);
			expect(document.configs[1].diagnostics).toEqual([]);
			expect(result.isErr() && result.error).toBeInstanceOf(
				ReportedError
			);
			expect(await fs.exists(abs("lobby/default.project.json"))).toBe(
				false
			);
			expect(await fs.exists(abs("arena/default.project.json"))).toBe(
				false
			);
		});

		it("should say a project file that could not be written was not written, and why, and still print the rest", async () => {
			await fs.writeFile(abs("lobby/src/A.luau"), "");
			await fs.writeFile(abs("arena/src/B.luau"), "");
			await fs.createDirectory(abs("arena/default.project.json"));

			const { result, document } = await buildJson(
				new MockConfigService([
					buildable({}, "lobby"),
					buildable({}, "arena"),
				])
			);

			expect(
				document.configs.map(
					({ file, outcome }: Record<string, string>) => [
						file,
						outcome,
					]
				)
			).toEqual([
				["/repo/lobby/rogen.json", "wrote"],
				["/repo/arena/rogen.json", "notWritten"],
			]);
			expect(document.configs[1].diagnostics).toEqual([
				expect.objectContaining({
					file: abs("arena/default.project.json"),
					severity: "error",
					code: "output.writeFailed",
				}),
			]);
			expect(result.isErr() && result.error).toBeInstanceOf(
				ReportedError
			);
			expect(await fs.exists(abs("lobby/default.project.json"))).toBe(
				true
			);
		});

		it("should print nothing but the document", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const { logService } = await buildJson(
				new MockConfigService([buildable()])
			);

			expect(
				logService.entries.filter(({ kind }) => kind !== "print")
			).toEqual([]);
		});

		it("should print a config that doesn't load as an entry that wasn't written", async () => {
			const entry = brokenEntry([
				errorDiagnostic(
					"config.removedField",
					{ resource: "/repo/rogen.json" },
					"boom."
				),
			]);

			const { result, document } = await buildJson(
				new MockConfigService([entry])
			);

			expect(result.isErr() && result.error).toBeInstanceOf(
				ReportedError
			);
			expect(document).toEqual({
				configs: [
					{
						config: "repo",
						file: "/repo/rogen.json",
						projectFile: null,
						outcome: "notWritten",
						diagnostics: [
							expect.objectContaining({
								code: "config.removedField",
							}),
						],
					},
				],
			});
		});

		it("should name the configs that blocked a config that was not written", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const broken = brokenEntry([], "/repo/broken/rogen.json");

			const { document } = await buildJson(
				new MockConfigService([buildable({}, "lobby"), broken])
			);

			expect(document.configs[0]).toMatchObject({
				outcome: "notWritten",
				blockedBy: ["broken"],
			});
			expect(Object.keys(document.configs[0])).toEqual([
				"config",
				"file",
				"projectFile",
				"outcome",
				"blockedBy",
				"diagnostics",
			]);
		});
	});

	describe("flags", () => {
		const registry = Registry.as<CommandRegistry>(Extensions.Commands);
		const parse = (...argv: string[]) =>
			parseArgs(argv, (command) => registry.getOptions(command), [
				...registry.getCommands().keys(),
			]);

		it("should parse the projects as positionals and the flags as options", () => {
			const { command, line } = parse(
				"build",
				"lobby",
				"places/arena",
				"--deny-warnings",
				"--json"
			).unwrap();

			expect(command).toBe("build");
			expect(line.positionals).toEqual(["lobby", "places/arena"]);
			expect(line.options).toEqual({
				"deny-warnings": true,
				json: true,
			});
		});

		it.each(["--variant", "--no-variant", "--mode"])(
			"should reject %s, which a removed feature took",
			(flag) => {
				expect(parse("build", flag, "prod").isErr()).toBe(true);
			}
		);

		it.each([
			"--out-file",
			"--all",
			"-c",
			"--config",
			"-s",
			"--sync-dir",
			"--template",
			"--no-input",
			"--profile",
			"--env",
			"--mode",
			"--build",
			"--init",
			"--trace",
			"--show-config",
		])("should reject the old flag %s", (flag) => {
			expect(parse("build", flag).isErr()).toBe(true);
		});
	});

	describe("-o and -p", () => {
		let processes: MockProcessService;

		const withRojo = async (
			options: CommandLine["options"],
			config = new MockConfigService([buildable()])
		) => {
			await fs.writeFile(abs("src/A.luau"), "");
			const log = new MockLogService();
			const running = commandHarness({
				fs,
				log,
				config,
				processes,
			}).run("build", { positionals: [], options });
			return { log, running };
		};

		const rojoStarted = async () => {
			for (let i = 0; i < 50 && processes.spawned.length === 0; i++)
				await new Promise((resolve) => setImmediate(resolve));
			return processes.spawned[0];
		};

		beforeEach(() => {
			processes = new MockProcessService();
			processes.installed.set("rojo", "/bin/rojo");
			processes.outputs.set("/bin/rojo", {
				code: 0,
				stdout: "Rojo 7.7.1\n",
				stderr: "",
			});
		});

		it("should write the project file, then run Rojo's build on it with --output", async () => {
			const { running } = await withRojo({ output: "game.rbxl" });
			const rojo = await rojoStarted();
			rojo.exit({ code: 0, signal: null });

			expect((await running).isOk()).toBe(true);
			expect(rojo.file).toBe("/bin/rojo");
			expect(rojo.args).toEqual([
				"build",
				"default.project.json",
				"--output",
				"game.rbxl",
			]);
			expect(await fs.exists(abs("default.project.json"))).toBe(true);
		});

		it("should pass --plugin for -p", async () => {
			const { running } = await withRojo({ plugin: "Tool.rbxm" });
			const rojo = await rojoStarted();
			rojo.exit({ code: 0, signal: null });
			await running;

			expect(rojo.args.slice(2)).toEqual(["--plugin", "Tool.rbxm"]);
		});

		it("should show what Rojo said", async () => {
			const { running, log } = await withRojo({ output: "g.rbxl" });
			const rojo = await rojoStarted();
			rojo.print("[WARN rojo] a warning\n");
			rojo.exit({ code: 0, signal: null });
			await running;

			expect(log.entries).toContainEqual({
				kind: "warn",
				text: "Rojo: a warning",
			});
		});

		it("should fail when Rojo fails", async () => {
			const { running } = await withRojo({ output: "g.rbxl" });
			const rojo = await rojoStarted();
			rojo.print("ERROR: no such folder\n");
			rojo.exit({ code: 1, signal: null });

			const result = await running;

			expect((result as ResultError<Error>).error.message).toContain(
				"'rojo build' failed (exit code 1): no such folder"
			);
		});

		it("should not run Rojo when the build has errors", async () => {
			const { running } = await withRojo(
				{ output: "g.rbxl" },
				new MockConfigService([
					brokenEntry([
						errorDiagnostic(
							"config.invalidSyntax",
							{
								resource: abs("rogen.json"),
							},
							"bad"
						),
					]),
				])
			);

			expect((await running).isErr()).toBe(true);
			expect(processes.spawned).toEqual([]);
		});

		it("should refuse -o and -p together", async () => {
			const { running } = await withRojo({ output: "a", plugin: "b" });

			expect((await running).isErr()).toBe(true);
			expect(processes.spawned).toEqual([]);
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});

		it("should run no Rojo without -o or -p", async () => {
			const { running } = await withRojo({});

			expect((await running).isOk()).toBe(true);
			expect(processes.spawned).toEqual([]);
		});
	});
});
