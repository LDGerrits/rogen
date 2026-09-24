import path from "path";
import { jest } from "@jest/globals";
import "../build-command.js";
import { ResultError } from "../../../base/result.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import {
	MockConfigService,
	mockEntry,
} from "../../../domain/config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../../domain/config/config.js";
import {
	ConfigEntry,
	ConfigService,
} from "../../../domain/config/config-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { ParsedArgs } from "../../../platform/environment/args.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import {
	LogService,
	NullLogService,
} from "../../../platform/log/log-service.js";

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
		args: ParsedArgs = { _: ["build"] },
		index: IndexService = store.add(new CoreIndexService(fs))
	) => {
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(ConfigService, configService);
		services.set(FileSystemService, fs);
		services.set(IndexService, index);
		services.set(
			EnvironmentService,
			new MockEnvironmentService(undefined, "/repo")
		);
		return store
			.add(new CoreCommandService(services, logService))
			.executeCommand("build", args);
	};

	const buildable = (
		overrides: Partial<ResolvedConfig> = {},
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
		const info = jest.spyOn(logService, "info");

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
		expect(info).toHaveBeenCalledWith("Wrote default.project.json.");
	});

	it("should write one file per config from a shared scan", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const index = store.add(new CoreIndexService(fs));
		const initialize = jest.spyOn(index, "initialize");

		const result = await run(
			new MockConfigService([
				buildable({}, "/repo/default.rogen.json"),
				buildable(
					{ outFile: abs("source.project.json") },
					"/repo/source.rogen.json"
				),
			]),
			new NullLogService(),
			{ _: ["build"] },
			index
		);

		expect(result.isOk()).toBe(true);
		expect(initialize).toHaveBeenCalledTimes(1);
		expect(initialize).toHaveBeenCalledWith([abs("src")]);
		expect(await fs.exists(abs("default.project.json"))).toBe(true);
		expect(await fs.exists(abs("source.project.json"))).toBe(true);
	});

	it("should leave an unchanged project file alone", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		await run(new MockConfigService([buildable()]), new NullLogService());
		const logService = new NullLogService();
		const info = jest.spyOn(logService, "info");

		const result = await run(
			new MockConfigService([buildable()]),
			logService
		);

		expect(result.isOk()).toBe(true);
		expect(info).toHaveBeenCalledWith(
			"default.project.json is up to date."
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

	it("should warn about unrouted files without failing", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const logService = new NullLogService();
		const warn = jest.spyOn(logService, "warn");

		const result = await run(
			new MockConfigService([
				buildable({ routes: { server: "ServerScriptService" } }),
			]),
			logService
		);

		expect(result.isOk()).toBe(true);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("matched no route")
		);
		expect(await fs.exists(abs("default.project.json"))).toBe(true);
	});

	it("should warn when nothing the config emits exists under its sync dir", async () => {
		await fs.writeFile(abs("src/A.luau"), "");
		const logService = new NullLogService();
		const warn = jest.spyOn(logService, "warn");

		const result = await run(
			new MockConfigService([buildable({ syncDir: abs("out") })]),
			logService
		);

		expect(result.isOk()).toBe(true);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("nothing emitted")
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

	it("should refuse to build when a config is invalid", async () => {
		const logService = new NullLogService();
		const entry = {
			...mockEntry(),
			diagnostics: [
				errorDiagnostic(
					"config.unknownField",
					{ resource: "/repo/default.rogen.json" },
					"boom."
				),
			],
		};

		const result = await run(new MockConfigService([entry]), logService);

		expect((result as ResultError<Error>).error.message).toBe(
			"/repo/default.rogen.json - error: boom."
		);
	});

	it("should name the configs here that it was not asked to build", async () => {
		await fs.writeFile("/repo/default.rogen.json", "{}");
		await fs.writeFile("/repo/source.rogen.json", "{}");
		await fs.writeFile("/repo/base.rogen.json", "{}");
		await fs.writeFile("/repo/notes.json", "{}");
		const logService = new NullLogService();
		const info = jest.spyOn(logService, "info");

		await run(new MockConfigService([mockEntry()]), logService);

		expect(info).toHaveBeenCalledWith(
			"Not building: base.rogen.json, source.rogen.json."
		);
	});

	it("should print no such line when every config here is built", async () => {
		await fs.writeFile("/repo/default.rogen.json", "{}");
		const logService = new NullLogService();
		const info = jest.spyOn(logService, "info");

		await run(new MockConfigService([mockEntry()]), logService);

		expect(info).not.toHaveBeenCalledWith(
			expect.stringContaining("Not building")
		);
	});

	describe("--show-config", () => {
		const show = (entries: ConfigEntry[]) => {
			const logService = new NullLogService();
			const info = jest.spyOn(logService, "info");
			const result = run(new MockConfigService(entries), logService, {
				_: ["build"],
				"show-config": true,
			});
			return { info, result };
		};

		it("should print the resolved config as strict JSON, with the derived values", async () => {
			const { info, result } = show([
				mockEntry({
					name: "Game",
					rootDirs: ["/repo/core/src", "/repo/lobby/src"],
					routes: { server: "ServerScriptService" },
					tags: { mock: true },
					exclude: ["/repo/**/*.spec.luau"],
					outFile: "/repo/default.project.json",
				}),
			]);

			expect((await result).isOk()).toBe(true);
			expect(info).toHaveBeenCalledTimes(1);
			expect(JSON.parse(String(info.mock.calls[0][0]))).toEqual({
				name: "Game",
				rootDirs: ["/repo/core/src", "/repo/lobby/src"],
				commonRoot: "/repo",
				routes: { server: "ServerScriptService" },
				tags: { mock: true },
				exclude: ["/repo/**/*.spec.luau"],
				template: null,
				syncDir: null,
				outFile: "/repo/default.project.json",
			});
		});

		it("should name the template file and the sync dir when they are set", async () => {
			const { info, result } = show([
				mockEntry({
					rootDirs: ["/repo/src"],
					syncDir: "/repo/out",
					template: {
						file: "/repo/base.project.json",
						project: { name: "Base" },
					},
				}),
			]);
			await result;

			expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({
				template: "/repo/base.project.json",
				syncDir: "/repo/out",
			});
		});

		it("should print one JSON object keyed by config file for several configs", async () => {
			const { info, result } = show([
				mockEntry({ rootDirs: ["/repo/a"] }, "/repo/lobby.rogen.json"),
				mockEntry({ rootDirs: ["/repo/b"] }, "/repo/match.rogen.json"),
			]);
			await result;

			const printed = JSON.parse(String(info.mock.calls[0][0]));
			expect(Object.keys(printed)).toEqual([
				"lobby.rogen.json",
				"match.rogen.json",
			]);
			expect(printed["match.rogen.json"].rootDirs).toEqual(["/repo/b"]);
		});

		it("should not build, and not print anything but the config", async () => {
			await fs.writeFile("/repo/other.rogen.json", "{}");
			const { info, result } = show([mockEntry()]);
			await result;

			expect(info).toHaveBeenCalledTimes(1);
			expect(String(info.mock.calls[0][0])).not.toContain("Building");
		});

		it("should print a broken config's diagnostics in its own entry and fail", async () => {
			const broken = {
				...mockEntry({}, "/repo/broken.rogen.json"),
				resolved: undefined,
				diagnostics: [
					errorDiagnostic(
						"config.unknownField",
						{ resource: "/repo/broken.rogen.json" },
						"boom."
					),
				],
			};
			const { info, result } = show([
				mockEntry({}, "/repo/ok.rogen.json"),
				broken,
			]);

			expect(((await result) as ResultError<Error>).error.message).toBe(
				"1 of 2 configs have errors."
			);
			expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({
				"ok.rogen.json": { name: "repo" },
				"broken.rogen.json": {
					diagnostics: ["/repo/broken.rogen.json - error: boom."],
				},
			});
		});
	});
});
