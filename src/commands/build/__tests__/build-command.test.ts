import path from "path";
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
import { CommandLine } from "../../../platform/environment/args.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";

import { LogService } from "../../../platform/log/log-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { ReportedError } from "../../../platform/commands/commands.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";

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
			abs(folder, "default.rogen.json")
		);

	it("should refuse a second project, as Rojo's build does, and write nothing", async () => {
		await fs.writeFile(abs("src/A.luau"), "");

		const result = await run(
			new MockConfigService([buildable()]),
			new MockLogService(),
			{ positionals: ["a", "b"], options: {} }
		);

		expect((result as ResultError<Error>).error.message).toContain(
			"unexpected argument 'b' found: build takes one [PROJECT]"
		);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
	});

	it("should write the project file for a config", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const logService = new MockLogService();

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
		expect(logService.texts("success")).toContain(
			"default.project.json · wrote"
		);
	});

	describe("with several configs in the folder", () => {
		const config = ({
			rogen,
			...extra
		}: { rogen?: Record<string, unknown>; [key: string]: unknown } = {}) =>
			JSON.stringify({
				name: "Game",
				...extra,
				rogen: {
					sourcePaths: ["src"],
					routes: { "*": "ReplicatedStorage" },
					...rogen,
				},
			});

		beforeEach(async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			await fs.writeFile(abs("default.rogen.json"), config());
			await fs.writeFile(
				abs("dist.rogen.json"),
				config({ rogen: { syncPath: "dist" } })
			);
		});

		it("should write only the project file of the default with no argument", async () => {
			const { run } = commandHarness({ fs });

			const result = await run("build");

			expect(result.isOk()).toBe(true);
			expect(await fs.exists(abs("default.project.json"))).toBe(true);
			expect(await fs.exists(abs("dist.project.json"))).toBe(false);
		});

		it("should write only the project file of the config named", async () => {
			const { run } = commandHarness({ fs });

			const result = await run("build", {
				positionals: ["dist"],
				options: {},
			});

			expect(result.isOk()).toBe(true);
			expect(await fs.exists(abs("dist.project.json"))).toBe(true);
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
		});

		it("should build the named config though a sibling you did not name is broken", async () => {
			await fs.writeFile(abs("release.rogen.json"), "{ broken");
			const { run } = commandHarness({ fs });

			const result = await run("build", {
				positionals: ["dist"],
				options: {},
			});

			expect(result.isOk()).toBe(true);
			expect(await fs.exists(abs("dist.project.json"))).toBe(true);
		});

		it("should warn that a folder wins over the file of the same name", async () => {
			await fs.writeFile(abs("dist/default.rogen.json"), config());
			await fs.writeFile(abs("dist/src/B.luau"), "");
			const { run, log } = commandHarness({ fs });

			await run("build", { positionals: ["dist"], options: {} });

			expect(log.texts("warn")).toContain(
				'"dist" is a folder with a default config and also dist.rogen.json: using the folder. To use the file, name it: dist.rogen.json.'
			);
		});
	});

	it("should write nothing when the config fails to build", async () => {
		await fs.writeFile(abs("bad/Combat/A.luau"), "");
		await fs.writeFile(abs("bad/Combat/init.meta.json"), '{"id": 1}');
		await fs.writeFile(
			abs("default.rogen.json"),
			JSON.stringify({
				rogen: {
					sourcePaths: ["bad"],
					routes: { "*": "ReplicatedStorage" },
				},
			})
		);
		const { run } = commandHarness({ fs });

		const result = await run("build");

		expect(result.isErr()).toBe(true);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
	});

	it("should fail for a name that is no folder or project file, and write nothing", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const { run } = commandHarness({ fs });

		const result = await run("build", {
			positionals: ["nope"],
			options: {},
		});

		expect((result as ResultError<Error>).error.message).toContain(
			'"nope" not found.'
		);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
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

	it("should name each config it didn't write, as watch does", async () => {
		await fs.writeFile(abs("lobby/src/A.luau"), "");
		await fs.writeFile(abs("bad/src/Combat/A.luau"), "");
		await fs.writeFile(abs("bad/src/Combat/init.meta.json"), '{"id": 1}');
		const logService = new MockLogService();

		await run(
			new MockConfigService([
				buildable({}, "lobby"),
				buildable({}, "bad"),
			]),
			logService
		);

		expect(logService.texts("error")).toEqual([
			"lobby/default.project.json · not written · bad failed",
			"bad/default.project.json · not written",
		]);
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
				{ resource: "/repo/default.rogen.json" },
				"boom."
			),
		]);

		const result = await run(new MockConfigService([entry]), logService);

		expect(result.isErr() && result.error).toBeInstanceOf(ReportedError);
		expect(logService.lines).toEqual([
			"intro: rogen build · repo",
			"error: default.rogen.json · not loaded",
			"diagnosticError: /repo/default.rogen.json - error: boom. (config.removedField)",
			expect.stringMatching(/^outro: .*fail/),
		]);
	});

	describe("a warning", () => {
		const withWarning = async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			return new MockConfigService([
				buildable({ routes: { server: "ServerScriptService" } }),
			]);
		};

		it("should exit 0, and write the project file", async () => {
			const logService = new MockLogService();

			const result = await run(await withWarning(), logService);

			expect(result.isOk()).toBe(true);
			expect(await fs.exists(abs("default.project.json"))).toBe(true);
			expect(logService.lines.at(-1)).toMatch(/1 warning\.$/);
		});

		it("should keep its severity and code under --json", async () => {
			const logService = new MockLogService();

			const result = await run(await withWarning(), logService, {
				positionals: [],
				options: { json: true },
			});

			expect(result.isOk()).toBe(true);
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
				changed: true,
				configs: [
					{
						config: "repo",
						file: "/repo/default.rogen.json",
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
			expect(document.changed).toBe(false);
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
				["/repo/lobby/default.rogen.json", "notWritten"],
				["/repo/arena/default.rogen.json", "notWritten"],
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
					{ resource: "/repo/default.rogen.json" },
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
				changed: false,
				configs: [
					{
						config: "repo",
						file: "/repo/default.rogen.json",
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
			await fs.writeFile(abs("lobby/src/A.luau"), "");
			const broken = brokenEntry([], "/repo/broken/default.rogen.json");

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

		it("should leave stdout to Rojo's lines when it builds, and keep its own there when it does not", async () => {
			const { log, running } = await withRojo({ output: "game.rbxl" });
			const rojo = await rojoStarted();
			rojo.print("Built project to game.rbxl\n");
			rojo.exit({ code: 0, signal: null });
			await running;

			expect(log.reserved).toBe(true);
			expect(log.texts("print")).toEqual(["Built project to game.rbxl"]);

			const plain = new MockLogService();
			await fs.writeFile(abs("src/A.luau"), "");
			await commandHarness({
				fs,
				log: plain,
				config: new MockConfigService([buildable()]),
			}).run("build", { positionals: [], options: {} });
			expect(plain.reserved).toBe(false);
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
			rojo.printError("ERROR: no such folder\n");
			rojo.exit({ code: 1, signal: null });

			const result = await running;

			expect((result as ResultError<Error>).error.message).toContain(
				"'rojo build' failed (exit code 1): no such folder"
			);
		});

		it("should show the warnings Rojo printed before it failed, and its error once", async () => {
			const { running, log } = await withRojo({ output: "g.rbxl" });
			const rojo = await rojoStarted();
			rojo.print("[WARN rojo] odd file\n");
			rojo.printError("ERROR: no such folder\n");
			rojo.exit({ code: 1, signal: null });

			await running;

			expect(log.entries).toContainEqual({
				kind: "warn",
				text: "Rojo: odd file",
			});
			expect(
				log.entries.filter(({ kind }) => kind === "error")
			).toHaveLength(0);
		});

		it("should not run Rojo when the build has errors", async () => {
			const { running } = await withRojo(
				{ output: "g.rbxl" },
				new MockConfigService([
					brokenEntry([
						errorDiagnostic(
							"config.invalidSyntax",
							{
								resource: abs("default.rogen.json"),
							},
							"bad"
						),
					]),
				])
			);

			expect((await running).isErr()).toBe(true);
			expect(processes.spawned).toEqual([]);
		});

		describe("with --json", () => {
			const document = (log: MockLogService) =>
				JSON.parse(log.texts("print")[0]);

			it("should tell Rojo's build beside the configs", async () => {
				const { running, log } = await withRojo({
					output: "game.rbxl",
					json: true,
				});
				const rojo = await rojoStarted();
				rojo.print("Built project to game.rbxl\n");
				rojo.exit({ code: 0, signal: null });

				expect((await running).isOk()).toBe(true);
				expect(document(log).rojo).toEqual({
					command: "build",
					outcome: "built",
					project: abs("default.project.json"),
					output: abs("game.rbxl"),
					messages: [
						{
							severity: "info",
							text: "Built project to game.rbxl",
						},
					],
				});
				expect(document(log).configs).toHaveLength(1);
			});

			it("should tell a plugin by its name", async () => {
				const { running, log } = await withRojo({
					plugin: "Tool.rbxm",
					json: true,
				});
				const rojo = await rojoStarted();
				rojo.exit({ code: 0, signal: null });
				await running;

				expect(document(log).rojo).toMatchObject({
					plugin: "Tool.rbxm",
				});
				expect(document(log).rojo.output).toBeUndefined();
			});

			it("should tell a failed Rojo with its diagnostic, and exit 1", async () => {
				const { running, log } = await withRojo({
					output: "g.rbxl",
					json: true,
				});
				const rojo = await rojoStarted();
				rojo.printError("ERROR: no such folder\n");
				rojo.exit({ code: 1, signal: null });

				const result = await running;

				expect(result.isErr()).toBe(true);
				const { rojo: entry } = document(log);
				expect(entry.outcome).toBe("failed");
				expect(entry.messages).toEqual([
					{ severity: "error", text: "no such folder" },
				]);
				expect(entry.diagnostics[0]).toMatchObject({
					code: "rojo.commandFailed",
					severity: "error",
				});
			});

			it("should say Rojo did not run when the build had errors", async () => {
				const { running, log } = await withRojo(
					{ output: "g.rbxl", json: true },
					new MockConfigService([
						brokenEntry([
							errorDiagnostic(
								"config.invalidSyntax",
								{ resource: abs("default.rogen.json") },
								"bad"
							),
						]),
					])
				);

				await running;

				expect(document(log).rojo).toMatchObject({
					outcome: "notRun",
					project: null,
					messages: [],
				});
			});

			it("should leave rojo out when no output was asked for", async () => {
				const { running, log } = await withRojo({ json: true });
				await running;

				expect(document(log).rojo).toBeUndefined();
			});
		});

		it("should write nothing when several projects leave Rojo none to run on", async () => {
			await fs.writeFile(abs("a/src/A.luau"), "");
			await fs.writeFile(abs("b/src/A.luau"), "");
			const { running } = await withRojo(
				{ output: "g.rbxl" },
				new MockConfigService([buildable({}, "a"), buildable({}, "b")])
			);

			const result = await running;

			expect((result as ResultError<Error>).error.message).toContain(
				"runs on one project, and this selects 2"
			);
			expect(await fs.exists(abs("a/default.project.json"))).toBe(false);
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
