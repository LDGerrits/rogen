import { jest } from "@jest/globals";
import { ConfigService } from "../config-service.js";
import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";
import { NativeEnvironmentService } from "../../environment/environment-service.js";
import { ParsedArgsSchema } from "../../environment/args.js";

describe("ConfigService", () => {
	let memFs: MemoryFileSystemService;

	const createEnvironment = (args: Record<string, unknown> = {}) => {
		const parsedArgs = ParsedArgsSchema.parse({ _: [], ...args });
		return new NativeEnvironmentService(parsedArgs, "/mock/cwd");
	};

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
	});

	it("should initialize successfully with a default config when optional and missing", async () => {
		const environment = createEnvironment();
		const configService = new ConfigService(memFs, environment);

		await configService.initialize();

		const config = configService.getValue<Record<string, unknown>>();
		expect(config).toBeDefined();
	});

	it("should parse file contents and merge with CLI overrides", async () => {
		await memFs.writeFile(
			"/mock/cwd/.rogen.json",
			JSON.stringify({ casing: "PascalCase" })
		);

		const environment = createEnvironment({ source: ["cli-src"] });
		const configService = new ConfigService(memFs, environment);

		await configService.initialize();

		expect(configService.getValue<string>("casing")).toBe("PascalCase");
		expect(configService.getValue<string[]>("source")).toEqual(["cli-src"]);
	});

	it("should fail initialization if a strictly requested config path is missing", async () => {
		const environment = createEnvironment({ config: "custom.json" });
		const configService = new ConfigService(memFs, environment);

		await expect(configService.initialize()).rejects.toThrow(
			"Specified config file not found"
		);
	});

	it("should fire the onDidChangeConfiguration event when reload is called", async () => {
		await memFs.writeFile(
			"/mock/cwd/.rogen.json",
			JSON.stringify({ casing: "PascalCase" })
		);
		const environment = createEnvironment();
		const configService = new ConfigService(memFs, environment);

		await configService.initialize();

		const listener = jest.fn();
		configService.onDidChangeConfiguration(listener);

		await memFs.writeFile(
			"/mock/cwd/.rogen.json",
			JSON.stringify({ casing: "camelCase" })
		);
		await configService.reloadConfiguration();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({ source: "file" });
		expect(configService.getValue<string>("casing")).toBe("camelCase");
	});

	it("should clean up its listeners when disposed", async () => {
		const environment = createEnvironment();
		const configService = new ConfigService(memFs, environment);

		const listener = jest.fn();
		configService.onDidChangeConfiguration(listener);

		configService[Symbol.dispose]();

		await configService.reloadConfiguration();

		expect(listener).not.toHaveBeenCalled();
	});
});
