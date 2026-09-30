import "../where-command.js";
import "../../../domain/config/config-schema.js";
import { DisposableStore } from "../../../base/disposable.js";
import { Result } from "../../../base/result.js";
import { BuildService } from "../../../domain/build/build-service.js";
import { ConfigService } from "../../../domain/config/config-service.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { ParsedArgs, parseArgs } from "../../../platform/environment/args.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import { LogService } from "../../../platform/log/log-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { buildServiceOf } from "../../../domain/build/__tests__/fixtures.js";
import {
	CommandRegistry,
	Extensions,
} from "../../../platform/commands/commands.js";
import { Registry } from "../../../platform/registry/registry.js";

const ROUTES = {
	Server: "ServerScriptService",
	Client: "StarterPlayer/StarterPlayerScripts",
	"*": "ReplicatedStorage/Shared",
};

describe("where command", () => {
	let store: DisposableStore;
	let fs: MemoryFileSystemService;
	let logService: MockLogService;
	let run: (
		args: Omit<ParsedArgs, "_"> & { _?: string[] }
	) => Promise<Result<void, Error>>;

	const write = async (...paths: string[]) => {
		for (const p of paths) await fs.writeFile(`/repo/${p}`, "");
	};

	const writeConfig = (file: string, config: Record<string, unknown>) =>
		fs.writeFile(`/repo/${file}`, JSON.stringify(config));

	const printed = () =>
		logService.entries
			.filter(({ kind }) => kind === "print")
			.flatMap(({ text }) => text.split("\n"));

	beforeEach(async () => {
		store = new DisposableStore();
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		logService = new MockLogService();
		const environment = new MockEnvironmentService(undefined, "/repo");
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(FileSystemService, fs);
		services.set(EnvironmentService, environment);
		const indexService = store.add(new CoreIndexService(fs));
		services.set(IndexService, indexService);
		services.set(BuildService, buildServiceOf(fs, indexService));
		const configService = store.add(new CoreConfigService(fs, environment));
		services.set(ConfigService, configService);
		const commandService = store.add(
			new CoreCommandService(services, logService)
		);
		run = async ({ _ = [], ...options }) => {
			const args = { _: ["where", ..._], ...options };
			return commandService.executeCommand("where", args);
		};
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should print where each path lands and why, relative to the working directory", async () => {
		await writeConfig("default.rogen.json", {
			routes: ROUTES,
			tags: { mock: false },
		});
		await write(
			"src/Net/HttpClient.luau",
			"src/Net/HttpMock.luau",
			"src/Util.luau"
		);

		const result = await run({
			_: [
				"src/Net/HttpClient.luau",
				"src/Net/HttpMock.luau",
				"src/Util.luau",
				"src/Combat/Server/Hit.luau",
			],
		});

		expect(result.isOk()).toBe(true);
		expect(printed()).toEqual([
			"src/Net/HttpClient.luau -> StarterPlayer/StarterPlayerScripts/Net/Http · route Client (capital suffix)",
			"src/Net/HttpMock.luau -> pruned · tag mock is off (capital suffix)",
			"src/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
			"src/Combat/Server/Hit.luau -> ServerScriptService/Combat/Hit · route Server (folder)",
		]);
	});

	it("should print the files behind an instance pasted from a Studio error", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await write("src/Inventory/Server/Save.luau", "src/Inventory/Types.luau");

		await run({
			_: [
				"ServerScriptService.Inventory.Save:12: attempt to index nil",
				"ReplicatedStorage/Shared/Inventory",
				"ServerScriptService.Missing",
			],
		});

		expect(printed()).toEqual([
			"src/Inventory/Server/Save.luau -> ServerScriptService/Inventory/Save · route Server (folder)",
			"src/Inventory/Types.luau -> ReplicatedStorage/Shared/Inventory/Types · route * (fallback)",
			"ServerScriptService.Missing -> no file places it",
		]);
	});

	it("should read an argument as a path when the working directory holds a folder named after its service", async () => {
		await writeConfig("default.rogen.json", {
			rootDirs: ["."],
			routes: { ...ROUTES, ReplicatedFirst: "ReplicatedFirst" },
		});
		await write("ReplicatedFirst/Boot.client.luau");

		await run({ _: ["ReplicatedFirst/Boot.client.luau"] });

		expect(printed()).toEqual([
			"ReplicatedFirst/Boot.client.luau -> ReplicatedFirst/Boot · route ReplicatedFirst (folder)",
		]);
	});

	it("should print every file in the tree when given no path", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await write("src/B.luau", "src/A/Server/C.luau");

		await run({});

		expect(printed()).toEqual([
			"src/A/Server/C.luau -> ServerScriptService/A/C · route Server (folder)",
			"src/B.luau -> ReplicatedStorage/Shared/B · route * (fallback)",
		]);
	});

	it("should read the config -c names, with tag flags applied", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await writeConfig("mocked.rogen.json", {
			routes: ROUTES,
			tags: { mock: false },
		});
		await write("src/Http.mock.luau");

		await run({
			_: ["src/Http.mock.luau"],
			config: ["mocked.rogen.json"],
			tag: ["mock"],
		});

		expect(printed()).toEqual([
			"src/Http.mock.luau -> ReplicatedStorage/Shared/Http · route * (fallback) · tag mock (suffix)",
		]);
	});

	describe("with several configs", () => {
		beforeEach(async () => {
			await writeConfig("default.rogen.json", { routes: ROUTES });
			await writeConfig("lobby.rogen.json", {
				routes: ROUTES,
				rootDirs: ["src", "places/lobby"],
			});
			await write("src/Util.luau", "places/lobby/Queue.luau");
		});

		it("should print a line once when the configs agree and head each config's line when they differ", async () => {
			await run({
				_: ["src/Util.luau", "places/lobby/Queue.luau"],
				all: true,
			});

			expect(printed()).toEqual([
				"src/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
				"default: places/lobby/Queue.luau -> outside the root dirs",
				"lobby: places/lobby/Queue.luau -> ReplicatedStorage/Shared/Queue · route * (fallback)",
			]);
		});

		it("should head only the lines that some configs lack in the whole tree, sorted", async () => {
			await run({ all: true });

			expect(printed()).toEqual([
				"lobby: places/lobby/Queue.luau -> ReplicatedStorage/Shared/Queue · route * (fallback)",
				"src/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
			]);
		});
	});

	it("should place a file that doesn't exist yet in the init folder that holds it", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await write(
			"src/Combat/Server/Moves/init.luau",
			"src/Combat/Server/Moves/Punch.luau"
		);

		await run({ _: ["src/Combat/Server/Moves"] });
		const asked = printed();
		logService.clear();
		await run({ _: ["src/Combat/Server/Moves/Sweep.luau"] });

		expect(asked).toEqual([
			"src/Combat/Server/Moves/Punch.luau -> ServerScriptService/Combat/Moves/Punch · route Server (folder)",
			"src/Combat/Server/Moves/init.luau -> ServerScriptService/Combat/Moves · route Server (folder)",
		]);
		expect(printed()).toEqual([
			"src/Combat/Server/Moves/Sweep.luau -> ServerScriptService/Combat/Moves/Sweep · route Server (folder)",
		]);
	});

	it("should fail with the config's errors", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES, bogus: 1 });

		const result = await run({ _: ["src/A.luau"] });

		expect(result.isErr()).toBe(true);
		expect(printed()).toEqual([]);
	});

	describe("flags", () => {
		const registry = Registry.as<CommandRegistry>(Extensions.Commands);
		const parse = (...argv: string[]) =>
			parseArgs(argv, (command) => registry.getOptions(command));

		it("should accept the config-picking flags, but not the output overrides", () => {
			expect(
				parse(
					"where",
					"src",
					"--all",
					"-c",
					"a.rogen.json",
					"-t",
					"mock",
					"-T",
					"dev"
				).isOk()
			).toBe(true);
			expect(parse("where", "-o", "out.project.json").isErr()).toBe(true);
			expect(parse("where", "-s", "dist").isErr()).toBe(true);
		});
	});
});
