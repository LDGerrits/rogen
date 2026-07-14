import fs from "fs";
import { jest } from "@jest/globals";
import { getEnvironment, loadAndValidateConfig, resolveActiveModes } from "../src/config.js";
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

describe("Environment Detection", () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	it("should detect a TS project from a tsconfig.json marker when no mode is given", () => {
		jest.spyOn(fs, "existsSync").mockImplementation((p) => String(p).endsWith("tsconfig.json"));
		expect(getEnvironment("/mock/anchor").isTsProject).toBe(true);
	});

	it("should treat an explicit --mode ts as a TS project even without a tsconfig.json in the cwd", () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(false);
		expect(getEnvironment("/mock/anchor", "ts").isTsProject).toBe(true);
	});

	it("should treat an explicit non-ts --mode as authoritative over a tsconfig.json marker", () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);
		expect(getEnvironment("/mock/anchor", "luau").isTsProject).toBe(false);
	});

	it("should prioritize CLI mode over filesystem markers", () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(false);

		const env = getEnvironment("/mock/anchor", "ts");
		
		expect(env.isTsProject).toBe(true);
		expect(env.isDarkluaProject).toBe(false);
	});

	it("should correctly detect environment via filesystem if no CLI mode is provided", () => {
		jest.spyOn(fs, "existsSync").mockImplementation((pathStr) => 
			String(pathStr).endsWith("tsconfig.json")
		);

		const env = getEnvironment("/mock/anchor");
		
		expect(env.isTsProject).toBe(true);
		expect(env.isDarkluaProject).toBe(false);
	});
});
