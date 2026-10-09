import path from "path";
import { jest } from "@jest/globals";
import "../build-command.js";
import { ReportedError } from "../../../base/errors.js";
import { ResultError } from "../../../base/result.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import {
	MockConfigService,
	brokenEntry,
	mockEntry,
} from "../../../domain/config/__tests__/mock-config-service.js";
import { BuildService } from "../../../domain/build/build-service.js";
import { ResolvedConfigSpec } from "../../../domain/config/__tests__/mock-config-service.js";
import { ConfigService } from "../../../domain/config/config-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { CommandLine, parseArgs } from "../../../platform/environment/args.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import { LogService } from "../../../platform/log/log-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { buildServiceOf } from "../../../domain/build/__tests__/fixtures.js";
import {
	CommandRegistry,
	Extensions,
} from "../../../platform/commands/commands.js";
import { Registry } from "../../../platform/registry/registry.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

describe("build command", () => {
	let store: DisposableStore;
	let fs: MemoryFileSystemService;

	beforeEach(async () => {
		store = new DisposableStore();
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	const run = (
		configService: MockConfigService,
		logService: LogService,
		line: CommandLine = { positionals: [], options: {} },
		index: IndexService = new CoreIndexService(fs)
	) => {
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(ConfigService, configService);
		services.set(FileSystemService, fs);
		services.set(IndexService, index);
		services.set(BuildService, buildServiceOf(fs, index));
		services.set(EnvironmentService, new MockEnvironmentService("/repo"));
		return new CoreCommandService(services, logService).executeCommand(
			"build",
			line
		);
	};

	const buildable = (
		overrides: ResolvedConfigSpec = {},
		file = "/repo/default.rogen.json"
	) =>
		mockEntry(
			{
				rootDirs: [abs("src")],
				routes: { "*": "ReplicatedStorage" },
				...overrides,
			},
			file
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
			name: "repo",
			tree: {
				ReplicatedStorage: {
					A: { $path: { optional: "src/A.luau" } },
				},
			},
		});
		expect(success).toHaveBeenCalledWith("default.project.json · wrote");
	});

	it("should write one file per config from a shared scan", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const readDirectory = jest.spyOn(fs, "readDirectory");

		const result = await run(
			new MockConfigService([
				buildable({}, "/repo/default.rogen.json"),
				buildable(
					{ outFile: abs("source.project.json") },
					"/repo/source.rogen.json"
				),
			]),
			new NullLogService(),
			{ positionals: [], options: {} }
		);

		expect(result.isOk()).toBe(true);
		expect(
			readDirectory.mock.calls.filter(([dir]) => dir === abs("src"))
		).toHaveLength(1);
		expect(await fs.exists(abs("default.project.json"))).toBe(true);
		expect(await fs.exists(abs("source.project.json"))).toBe(true);
	});

	it("should open with a header, group each config in a step and close with a result", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const logService = new MockLogService();

		await run(
			new MockConfigService([
				buildable({}, "/repo/default.rogen.json"),
				buildable(
					{ outFile: abs("lobby.project.json") },
					"/repo/lobby.rogen.json"
				),
			]),
			logService
		);

		expect(logService.lines).toEqual([
			"intro: rogen build · default, lobby",
			"step: default",
			"success: default.project.json · wrote",
			"step: lobby",
			"success: lobby.project.json · wrote",
			"outro: Built 2 configs.",
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

	it("should leave an unchanged project file alone", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		await run(new MockConfigService([buildable()]), new NullLogService());
		const logService = new NullLogService();
		const success = jest.spyOn(logService, "success");

		const result = await run(
			new MockConfigService([buildable()]),
			logService
		);

		expect(result.isOk()).toBe(true);
		expect(success).toHaveBeenCalledWith(
			"default.project.json · unchanged"
		);
	});

	it("should fail and write nothing when a config declares no routes", async () => {
		await fs.writeFile(abs("src/A.luau"), "");

		const result = await run(
			new MockConfigService([
				buildable({}, "/repo/default.rogen.json"),
				buildable(
					{ routes: {}, outFile: abs("bare.project.json") },
					"/repo/bare.rogen.json"
				),
			]),
			new NullLogService()
		);

		expect((result as ResultError<Error>).error.message).toContain(
			"/repo/bare.rogen.json - error: no routes declared"
		);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
		expect(await fs.exists(abs("bare.project.json"))).toBe(false);
	});

	it("should fail and write nothing when two configs share an output file", async () => {
		await fs.writeFile(abs("src/A.luau"), "");

		const result = await run(
			new MockConfigService([
				buildable({}, "/repo/default.rogen.json"),
				buildable({}, "/repo/source.rogen.json"),
			]),
			new NullLogService()
		);

		expect((result as ResultError<Error>).error.message).toContain(
			"write the same file"
		);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
	});

	it("should report an invalid folder meta once when two configs read it, and write nothing", async () => {
		await fs.writeFile(abs("src/Combat/A.luau"), "");
		await fs.writeFile(abs("src/Combat/init.meta.json"), '{"id": 1}');

		const result = await run(
			new MockConfigService([
				buildable({}, "/repo/default.rogen.json"),
				buildable(
					{ outFile: abs("source.project.json") },
					"/repo/source.rogen.json"
				),
			]),
			new NullLogService()
		);

		const message = (result as ResultError<Error>).error.message;
		expect(message.match(/init\.meta\.json/g)).toHaveLength(1);
		expect(message).toContain('"id": expected a string, found a number.');
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
	});

	it("should still print the sync dir warning of a config when another fails to build", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		await fs.writeFile(abs("bad/Combat/A.luau"), "");
		await fs.writeFile(abs("bad/Combat/init.meta.json"), '{"id": 1}');
		const logService = new NullLogService();
		const diagnostic = jest.spyOn(logService, "diagnostic");

		const result = await run(
			new MockConfigService([
				buildable({ syncDir: abs("out") }, "/repo/default.rogen.json"),
				buildable(
					{
						rootDirs: [abs("bad")],
						outFile: abs("bad.project.json"),
					},
					"/repo/bad.rogen.json"
				),
			]),
			logService
		);

		expect(result.isErr()).toBe(true);
		expect(diagnostic.mock.calls).toMatchObject([
			[{ message: expect.stringContaining("doesn't exist yet") }],
			[{ code: "meta.wrongType" }],
		]);
	});

	it("should name each config it didn't write, as watch does", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		await fs.writeFile(abs("bad/Combat/A.luau"), "");
		await fs.writeFile(abs("bad/Combat/init.meta.json"), '{"id": 1}');
		const logService = new NullLogService();
		const error = jest.spyOn(logService, "error");

		await run(
			new MockConfigService([
				buildable({}, "/repo/default.rogen.json"),
				buildable(
					{
						rootDirs: [abs("bad")],
						outFile: abs("bad.project.json"),
					},
					"/repo/bad.rogen.json"
				),
			]),
			logService
		);

		expect(error.mock.calls).toEqual([
			["default.project.json · not written · bad failed"],
			["bad.project.json · not written"],
		]);
	});

	it("should warn about unrouted files without failing", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const logService = new NullLogService();
		const diagnostic = jest.spyOn(logService, "diagnostic");

		const result = await run(
			new MockConfigService([
				buildable({ routes: { server: "ServerScriptService" } }),
			]),
			logService
		);

		expect(result.isOk()).toBe(true);
		expect(diagnostic).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("matched no route"),
			})
		);
		expect(await fs.exists(abs("default.project.json"))).toBe(true);
	});

	it("should warn when nothing the config emits exists under its sync dir", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const logService = new NullLogService();
		const diagnostic = jest.spyOn(logService, "diagnostic");

		const result = await run(
			new MockConfigService([buildable({ syncDir: abs("out") })]),
			logService
		);

		expect(result.isOk()).toBe(true);
		expect(diagnostic).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("doesn't exist yet"),
			})
		);
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

	it("should report a config that doesn't load as part of the build, and fail", async () => {
		const logService = new MockLogService();
		const entry = brokenEntry([
			errorDiagnostic(
				"config.unknownField",
				{ resource: "/repo/default.rogen.json" },
				"boom."
			),
		]);

		const result = await run(new MockConfigService([entry]), logService);

		expect(result.isErr() && result.error).toBeInstanceOf(ReportedError);
		expect(logService.lines).toEqual([
			"intro: rogen build · default",
			"error: default.rogen.json · not loaded",
			"diagnosticError: /repo/default.rogen.json - error: boom. (config.unknownField)",
			"outro: build failed.",
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
			expect(logService.lines.at(-1)).toBe(
				"outro: Built 1 config with 1 warning; --deny-warnings fails the run."
			);
		});

		it("should exit 0 on a warning without the flag, and count it in the closing line", async () => {
			const logService = new MockLogService();

			const result = await run(await withWarning(), logService);

			expect(result.isOk()).toBe(true);
			expect(logService.lines.at(-1)).toBe(
				"outro: Built 1 config with 1 warning."
			);
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
			expect(logService.lines.at(-1)).toBe("outro: Built 1 config.");
		});

		it("should still fail on errors", async () => {
			const result = await run(
				new MockConfigService([
					brokenEntry([
						errorDiagnostic(
							"config.unknownField",
							{ resource: "/repo/default.rogen.json" },
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
					buildable({ routes }, "/repo/default.rogen.json"),
					buildable(
						{ routes, outFile: abs("lobby.project.json") },
						"/repo/lobby.rogen.json"
					),
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
						config: "default",
						file: "/repo/default.rogen.json",
						outFile: "/repo/default.project.json",
						outcome: "wrote",
						diagnostics: [],
					},
				],
			});
			expect(await fs.exists(abs("default.project.json"))).toBe(true);
		});

		it("should name the mode a config built in", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const { document } = await buildJson(
				new MockConfigService([
					buildable({ modes: { dev: {}, prod: {} }, mode: "prod" }),
				])
			);

			expect(document.configs[0]).toMatchObject({
				config: "default",
				mode: "prod",
			});
		});

		it("should leave the mode out for a config without modes", async () => {
			await fs.writeFile(abs("src/A.luau"), "");

			const { document } = await buildJson(
				new MockConfigService([buildable()])
			);

			expect(document.configs[0]).not.toHaveProperty("mode");
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
			await fs.writeFile(abs("src/Combat/A.luau"), "");
			await fs.writeFile(abs("src/Combat/init.meta.json"), '{"id": 1}');
			await fs.writeFile(abs("other/B.luau"), "");

			const { result, document } = await buildJson(
				new MockConfigService([
					buildable({}, "/repo/default.rogen.json"),
					buildable(
						{
							rootDirs: [abs("other")],
							outFile: abs("source.project.json"),
						},
						"/repo/source.rogen.json"
					),
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
				["/repo/default.rogen.json", "notWritten"],
				["/repo/source.rogen.json", "notWritten"],
			]);
			expect(document.configs[0].diagnostics).toEqual([
				expect.objectContaining({
					file: abs("src/Combat/init.meta.json"),
					severity: "error",
				}),
			]);
			expect(document.configs[1].diagnostics).toEqual([]);
			expect(result.isErr() && result.error).toBeInstanceOf(
				ReportedError
			);
			expect(await fs.exists(abs("default.project.json"))).toBe(false);
			expect(await fs.exists(abs("source.project.json"))).toBe(false);
		});

		it("should say a project file that could not be written was not written, and why, and still print the rest", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			await fs.writeFile(abs("other/B.luau"), "");
			await fs.createDirectory(abs("blocked"));

			const { result, document } = await buildJson(
				new MockConfigService([
					buildable(),
					buildable(
						{ rootDirs: [abs("other")], outFile: abs("blocked") },
						"/repo/lobby.rogen.json"
					),
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
				["/repo/default.rogen.json", "wrote"],
				["/repo/lobby.rogen.json", "notWritten"],
			]);
			expect(document.configs[1].diagnostics).toEqual([
				expect.objectContaining({
					file: abs("blocked"),
					severity: "error",
					code: "output.writeFailed",
				}),
			]);
			expect(result.isErr() && result.error).toBeInstanceOf(
				ReportedError
			);
			expect(await fs.exists(abs("default.project.json"))).toBe(true);
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
					"config.unknownField",
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
				configs: [
					{
						config: "default",
						file: "/repo/default.rogen.json",
						outFile: null,
						outcome: "notWritten",
						diagnostics: [
							expect.objectContaining({
								code: "config.unknownField",
							}),
						],
					},
				],
			});
		});

		it("should name the configs that blocked a config that was not written", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const broken = brokenEntry([], "/repo/broken.rogen.json");

			const { document } = await buildJson(
				new MockConfigService([buildable(), broken])
			);

			expect(document.configs[0]).toMatchObject({
				outcome: "notWritten",
				blockedBy: ["broken"],
			});
			expect(Object.keys(document.configs[0])).toEqual([
				"config",
				"file",
				"outFile",
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

		it("should parse every override flag, with the repeatable ones as arrays", () => {
			const { command, line } = parse(
				"build",
				"lobby",
				"places/a.rogen.json",
				"-o",
				"out.project.json",
				"--variant",
				"mock",
				"--variant",
				"dev",
				"--no-variant",
				"prod",
				"--mode",
				"release",
				"--json"
			).unwrap();

			expect(command).toBe("build");
			expect(line.positionals).toEqual(["lobby", "places/a.rogen.json"]);
			expect(line.options).toEqual({
				"out-file": "out.project.json",
				variant: ["mock", "dev"],
				"no-variant": ["prod"],
				mode: "release",
				json: true,
			});
		});

		it("should repeat --variant and --no-variant", () => {
			const { options } = parse(
				"build",
				"--variant",
				"mock",
				"--no-variant",
				"dev",
				"--no-variant",
				"prod"
			).unwrap().line;

			expect(options).toMatchObject({
				variant: ["mock"],
				"no-variant": ["dev", "prod"],
			});
		});

		it("should have no short flags for the variant options", () => {
			expect(parse("build", "-t", "mock").isErr()).toBe(true);
			expect(parse("build", "-T", "mock").isErr()).toBe(true);
		});

		it.each([
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
});
