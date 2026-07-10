import fs from "fs";
import { jest } from "@jest/globals";
import { loadAndValidateConfig, resolveActiveModes } from "../src/config.js";
import { defaultConfig } from "../src/constants.js";
import { Environment, RogenConfig } from "../src/types.js";

describe("Configuration Resolution", () => {
	const defaultEnv: Environment = { isTsProject: false, isDarkluaProject: false };

	afterEach(() => {
		jest.restoreAllMocks();
	});

	function mockConfigFile(config: Record<string, unknown>): void {
		jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config));
	}

	it("should default casing to camelCase", () => {
		expect(defaultConfig.casing).toBe("camelCase");

		mockConfigFile({ luau: { build: "src", output: "default.project.json" } });
		expect(loadAndValidateConfig("test.rogen.json").config.casing).toBe("camelCase");
	});

	it.each(["PascalCase", "camelCase"] as const)("should accept %s casing", (casing) => {
		mockConfigFile({ casing });

		const result = loadAndValidateConfig("test.rogen.json");

		expect(result.hasConfig).toBe(true);
		expect(result.config.casing).toBe(casing);
	});

	it.each(["pascalCase", "snake_case", true, null])("should reject unsupported casing value %p", (casing) => {
		mockConfigFile({ casing });

		expect(() => loadAndValidateConfig("test.rogen.json")).toThrow(/casing/i);
	});

	it("should fallback to luau if no config exists and environment is standard", () => {
		const modes = resolveActiveModes({}, false, undefined, defaultEnv);
		expect(modes).toHaveLength(1);
		expect(modes[0].build).toBe(defaultConfig.luau!.build);
	});

	it("should auto-detect TypeScript and use ts defaults", () => {
		const tsEnv: Environment = { isTsProject: true, isDarkluaProject: false };
		const modes = resolveActiveModes({}, false, undefined, tsEnv);
		
		expect(modes).toHaveLength(1);
		expect(modes[0].build).toBe(defaultConfig.ts!.build);
	});

	it("should throw an error if a requested CLI mode does not exist", () => {
		const customConfig: RogenConfig = { myCustomMode: { build: "dist", output: "custom.json" } };
		
		expect(() => {
			resolveActiveModes(customConfig, true, "nonExistentMode", defaultEnv);
		}).toThrow('Mode "nonExistentMode" is not defined in your config file.');
	});

	it("should not treat casing as an output mode", () => {
		const customConfig: RogenConfig = { casing: "PascalCase" };

		expect(() => {
			resolveActiveModes(customConfig, true, "casing", defaultEnv);
		}).toThrow('Mode "casing" is not defined in your config file.');
	});

	it("should successfully load a custom CLI mode", () => {
		const customConfig: RogenConfig = { myCustomMode: { build: "dist", output: "custom.json" } };
		const modes = resolveActiveModes(customConfig, true, "myCustomMode", defaultEnv);
		
		expect(modes).toHaveLength(1);
		expect(modes[0].build).toBe("dist");
	});
});
