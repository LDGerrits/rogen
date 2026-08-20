import { jest } from "@jest/globals";
import { CoreConfigService } from "../config-service.js";
import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";
import { ConfigTarget, ConfigChangeEvent } from "../config.js";
import { Extensions, ConfigRegistry } from "../config-registry.js";
import { Registry } from "../../registry/registry.js";
import { MockEnvironmentService } from "../../environment/__tests__/mock-environment-service.js";

describe("CoreConfigService & Enterprise Config Architecture", () => {
	let memFs: MemoryFileSystemService;

	beforeAll(() => {
		const registry = Registry.as<ConfigRegistry>(Extensions.Config);

		registry.registerConfig({
			id: "mock-test-config",
			type: "object",
			properties: {
				casing: {
					type: "string",
					default: "camelCase",
				},
				source: {
					type: "array",
					items: { type: "string" },
					default: ["src"],
				},
				verbatim: {
					type: "boolean",
					default: false,
				},
			},
		});
	});

	beforeEach(async () => {
		memFs = new MemoryFileSystemService();
		await memFs.createDirectory("/mock/cwd");
	});

	it("should initialize successfully with default config values when no project file exists", async () => {
		const environment = new MockEnvironmentService();
		const configService = new CoreConfigService(memFs, environment);

		await configService.initialize();

		const casing = configService.getValue<string>("casing");
		expect(casing).toBe("camelCase");
	});

	it("should correctly resolve project config, CLI overrides, and provide deep inspection provenance", async () => {
		await memFs.writeFile(
			"/mock/cwd/.rogen.json",
			JSON.stringify({ casing: "PascalCase", verbatim: true })
		);

		const environment = new MockEnvironmentService({
			_: [],
			source: ["cli-src"],
		});
		const configService = new CoreConfigService(memFs, environment);

		await configService.initialize();

		expect(configService.getValue<string>("casing")).toBe("PascalCase");
		expect(configService.getValue<string[]>("source")).toEqual(["cli-src"]);

		const casingInspection = configService.inspect<string>("casing");
		expect(casingInspection.defaultValue).toBe("camelCase");
		expect(casingInspection.projectValue).toBe("PascalCase");
		expect(casingInspection.value).toBe("PascalCase");

		const sourceInspection = configService.inspect<string[]>("source");
		expect(sourceInspection.cliValue).toEqual(["cli-src"]);
		expect(sourceInspection.value).toEqual(["cli-src"]);
	});

	it("should prioritize exact .rogen.json when multiple files ending with .rogen.json are present", async () => {
		await memFs.writeFile(
			"/mock/cwd/.rogen.json",
			JSON.stringify({ casing: "PascalCase" })
		);
		await memFs.writeFile(
			"/mock/cwd/custom.rogen.json",
			JSON.stringify({ casing: "camelCase" })
		);

		const environment = new MockEnvironmentService();
		const configService = new CoreConfigService(memFs, environment);

		await configService.initialize();

		expect(configService.getValue<string>("casing")).toBe("PascalCase");
	});

	it("should use the alternative file if only one file ending with .rogen.json exists and it is not .rogen.json", async () => {
		await memFs.writeFile(
			"/mock/cwd/staging.rogen.json",
			JSON.stringify({ casing: "PascalCase" })
		);

		const environment = new MockEnvironmentService();
		const configService = new CoreConfigService(memFs, environment);

		await configService.initialize();

		expect(configService.getValue<string>("casing")).toBe("PascalCase");
	});

	it("should ignore all matching config files if multiple exist and none are named .rogen.json", async () => {
		await memFs.writeFile(
			"/mock/cwd/alpha.rogen.json",
			JSON.stringify({ casing: "PascalCase" })
		);
		await memFs.writeFile(
			"/mock/cwd/beta.rogen.json",
			JSON.stringify({ casing: "PascalCase" })
		);

		const environment = new MockEnvironmentService();
		const configService = new CoreConfigService(memFs, environment);

		await configService.initialize();

		expect(configService.getValue<string>("casing")).toBe("camelCase");
	});

	it("should fire precise change events featuring affectsConfig matching", async () => {
		await memFs.writeFile(
			"/mock/cwd/.rogen.json",
			JSON.stringify({ casing: "PascalCase" })
		);

		const environment = new MockEnvironmentService();
		const configService = new CoreConfigService(memFs, environment);

		await configService.initialize();

		const listener = jest.fn();
		configService.onDidChangeConfig(listener);

		await memFs.writeFile(
			"/mock/cwd/.rogen.json",
			JSON.stringify({ casing: "camelCase" })
		);
		await configService.reloadConfig();

		expect(listener).toHaveBeenCalledTimes(1);

		const event = listener.mock.calls[0][0] as ConfigChangeEvent;

		expect(event.source).toBe(ConfigTarget.PROJECT);
		expect(event.affectsConfig("casing")).toBe(true);
		expect(event.affectsConfig("source")).toBe(false);
		expect(configService.getValue<string>("casing")).toBe("camelCase");
	});

	it("should throw an error if a strictly requested custom config file path is missing", async () => {
		const environment = new MockEnvironmentService({
			_: [],
			config: "non-existent.json",
		});
		const configService = new CoreConfigService(memFs, environment);

		await expect(configService.initialize()).rejects.toThrow(
			"Specified config file not found"
		);
	});
});
