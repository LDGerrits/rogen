import fs from "fs";
import { jest } from "@jest/globals";
import {
	getEnvironment,
	loadConfig,
	resolveActiveModes,
} from "../src/config.js";
import { defaultConfig } from "../src/constants.js";
import { Environment, Config } from "../src/types.js";

describe("Configuration Resolution", () => {
	const defaultEnv: Environment = {
		isTsProject: false,
		isDarkluaProject: false,
	};

	afterEach(() => {
		jest.restoreAllMocks();
	});

	function mockConfigFile(config: Record<string, unknown>): void {
		jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config));
	}

	it.each(["PascalCase", "camelCase", "camel", "pascal"] as const)(
		"should accept %s casing",
		(casing) => {
			mockConfigFile({ casing });

			const result = loadConfig("test.rogen.json");

			expect(result.config.casing).toBe(casing);
		}
	);

	it.each(["kebab-case", "snake_case", true, null])(
		"should reject unsupported casing value %p",
		(casing) => {
			mockConfigFile({ casing });

			expect(() => loadConfig("test.rogen.json")).toThrow(/casing/i);
		}
	);

	it("should fallback to luau if no config exists and environment is standard", () => {
		const modes = resolveActiveModes(defaultConfig, undefined, defaultEnv);

		expect(modes).toHaveLength(1);
		expect(modes[0].config.build).toBe(defaultConfig.luau!.build);
	});

	it("should auto-detect TypeScript and use ts defaults", () => {
		const tsEnv: Environment = {
			isTsProject: true,
			isDarkluaProject: false,
		};
		const modes = resolveActiveModes(defaultConfig, undefined, tsEnv);

		expect(modes).toHaveLength(1);
		expect(modes[0].config.build).toBe(defaultConfig.ts!.build);
	});

	it("should throw an error if a requested CLI mode does not exist", () => {
		const customConfig: Config = {
			...defaultConfig,
			myCustomMode: {
				build: "dist",
				output: "custom.json",
				env: [],
				globIgnorePaths: [],
			},
		};

		expect(() => {
			resolveActiveModes(customConfig, ["nonExistentMode"], defaultEnv);
		}).toThrow(
			'mode "nonExistentMode" is not defined or is invalid in your config file.'
		);
	});

	it("should not treat casing as an output mode", () => {
		const customConfig: Config = { ...defaultConfig, casing: "PascalCase" };

		expect(() => {
			resolveActiveModes(customConfig, ["casing"], defaultEnv);
		}).toThrow(
			'mode "casing" is not defined or is invalid in your config file.'
		);
	});

	it("should successfully load a custom CLI mode", () => {
		const customConfig: Config = {
			...defaultConfig,
			myCustomMode: { build: "dist", output: "custom.json" },
		};
		const modes = resolveActiveModes(
			customConfig,
			["myCustomMode"],
			defaultEnv
		);

		expect(modes).toHaveLength(1);
		expect(modes[0].config.build).toBe("dist");
	});

	it("should accept a valid globIgnorePaths array", () => {
		mockConfigFile({ globIgnorePaths: ["**/*.spec.luau", "ignore/"] });

		const result = loadConfig("test.rogen.json");
		expect(result.config.globIgnorePaths).toEqual([
			"**/*.spec.luau",
			"ignore/",
		]);
	});

	it.each(["string_pattern", true, { pattern: "*" }, null])(
		"should reject unsupported globIgnorePaths value %p",
		(globIgnorePaths) => {
			mockConfigFile({ globIgnorePaths });

			expect(() => loadConfig("test.rogen.json")).toThrow(
				/globIgnorePaths/i
			);
		}
	);

	it("should bypass the typo check entirely if an unknown key acts like a valid custom mode", () => {
		mockConfigFile({ lute: { build: "dist", output: "test.json" } });

		const result = loadConfig("test.rogen.json");
		expect(result.config.lute).toBeDefined();
	});

	it("should throw a generic unknown key error for non-objects that are not typos", () => {
		mockConfigFile({ ignoreFiles: ["**/*.txt"] });

		expect(() => loadConfig("test.rogen.json")).toThrow(
			'unknown configuration key "ignoreFiles".'
		);
	});

	it("should still throw custom mode errors if a user attempts to define a mode but misses fields", () => {
		mockConfigFile({ myCustomMode: { build: "out" } });

		expect(() => loadConfig("test.rogen.json")).toThrow(
			'custom mode "myCustomMode" is missing a valid "output" string.'
		);
	});

	it("should throw a typo error if an object is passed but it resembles a core field", () => {
		mockConfigFile({ tmeplate: { $className: "DataModel" } });

		expect(() => loadConfig("test.rogen.json")).toThrow(
			'Did you mean "template"?'
		);
	});

	it("should reject the tags key if it is not a boolean key-value object", () => {
		jest.spyOn(fs, "readFileSync").mockReturnValue(
			JSON.stringify({ tags: ["dev", "prod"] })
		);

		expect(() => loadConfig("test.rogen.json")).toThrow(
			"'tags' must be a key-value object of booleans."
		);

		jest.spyOn(fs, "readFileSync").mockReturnValue(
			JSON.stringify({ tags: { dev: "true" } })
		);

		expect(() => loadConfig("test.rogen.json")).toThrow(
			'value for tag "dev" must be a boolean.'
		);
	});
});

describe("Environment Detection", () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	it("should detect a TS project from a tsconfig.json marker when no mode is given", () => {
		jest.spyOn(fs, "existsSync").mockImplementation((p) =>
			String(p).endsWith("tsconfig.json")
		);
		expect(getEnvironment("/mock/anchor").isTsProject).toBe(true);
	});

	it("should treat an explicit --mode ts as a TS project even without a tsconfig.json in the cwd", () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(false);
		expect(getEnvironment("/mock/anchor", ["ts"]).isTsProject).toBe(true);
	});

	it("should treat an explicit non-ts --mode as authoritative over a tsconfig.json marker", () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(true);
		expect(getEnvironment("/mock/anchor", ["luau"]).isTsProject).toBe(
			false
		);
	});

	it("should prioritize CLI mode over filesystem markers", () => {
		jest.spyOn(fs, "existsSync").mockReturnValue(false);

		const env = getEnvironment("/mock/anchor", ["ts"]);

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
