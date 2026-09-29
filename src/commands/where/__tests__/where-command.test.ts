import "../where-command.js";
import "../../../domain/config/config.js";
import { DisposableStore } from "../../../base/disposable.js";
import { Result } from "../../../base/result.js";
import { ConfigService } from "../../../domain/config/config-service.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { ParsedArgs } from "../../../platform/environment/args.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import { LogService } from "../../../platform/log/log-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";

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
		services.set(IndexService, store.add(new CoreIndexService(fs)));
		services.set(
			ConfigService,
			store.add(new CoreConfigService(fs, environment))
		);
		const commandService = store.add(
			new CoreCommandService(services, logService)
		);
		run = ({ _ = [], ...options }) =>
			commandService.executeCommand("where", {
				_: ["where", ..._],
				...options,
			});
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
			"src/Net/HttpClient.luau -> StarterPlayer/StarterPlayerScripts/Net/Http · route Client (suffix)",
			"src/Net/HttpMock.luau -> pruned · tag mock is off",
			"src/Util.luau -> ReplicatedStorage/Shared/Util · route * (fallback)",
			"src/Combat/Server/Hit.luau -> ServerScriptService/Combat/Hit · route Server (folder)",
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
			"src/Http.mock.luau -> ReplicatedStorage/Shared/Http · route * (fallback) · tag mock",
		]);
	});

	it("should head each config's lines with its name when there are several", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES });
		await writeConfig("lobby.rogen.json", {
			routes: ROUTES,
			rootDirs: ["src", "places/lobby"],
		});
		await write("places/lobby/Queue.luau");

		await run({ _: ["places/lobby/Queue.luau"], all: true });

		expect(printed()).toEqual([
			"default",
			"  places/lobby/Queue.luau -> outside the root dirs",
			"lobby",
			"  places/lobby/Queue.luau -> ReplicatedStorage/Shared/Queue · route * (fallback)",
		]);
	});

	it("should fail with the config's errors", async () => {
		await writeConfig("default.rogen.json", { routes: ROUTES, bogus: 1 });

		const result = await run({ _: ["src/A.luau"] });

		expect(result.isErr()).toBe(true);
		expect(printed()).toEqual([]);
	});
});
