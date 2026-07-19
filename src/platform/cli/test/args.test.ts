import { jest } from "@jest/globals";
import { logger } from "../../log/logger.js";
import { parseArgs } from "../args.js";

describe("CLI Argument Parsing", () => {
	let exitSpy: jest.SpiedFunction<typeof process.exit>;
	let loggerErrorSpy: jest.SpiedFunction<typeof logger.error>;
	let loggerInfoSpy: jest.SpiedFunction<typeof logger.info>;

	beforeEach(() => {
		exitSpy = jest
			.spyOn(process, "exit")
			.mockImplementation((code?: string | number | null) => {
				throw new Error(`Process exited with code ${code}`);
			});

		loggerErrorSpy = jest
			.spyOn(logger, "error")
			.mockImplementation(() => {});
		loggerInfoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe("Flag Parsing", () => {
		it("should parse full flags correctly", () => {
			const args = [
				"--mode",
				"ts",
				"--source",
				"my_src",
				"--watch",
				"--quiet",
			];
			const options = parseArgs(args);

			expect(options.mode).toEqual(["ts"]);
			expect(options.source).toEqual(["my_src"]);
			expect(options.watch).toBe(true);
			expect(options.quiet).toBe(true);
		});

		it("should parse short aliases correctly", () => {
			const args = ["-m", "luau", "-s", "other_src", "-w", "-q"];
			const options = parseArgs(args);

			expect(options.mode).toEqual(["luau"]);
			expect(options.source).toEqual(["other_src"]);
			expect(options.watch).toBe(true);
			expect(options.quiet).toBe(true);
		});

		it("should parse multiple array flags correctly", () => {
			const args = [
				"-s",
				"src/core",
				"-s",
				"src/chapter1",
				"-e",
				"dev",
				"--env",
				"prod",
			];
			const options = parseArgs(args);

			expect(options.source).toEqual(["src/core", "src/chapter1"]);
			expect(options.env).toEqual(["dev", "prod"]);
		});
	});

	describe("Subcommand Positional Mapping", () => {
		it("should map the 'init' positional correctly", () => {
			const options = parseArgs(["init"]);
			expect(options.init).toBe(true);
		});

		it("should map the 'watch' positional correctly alongside flags", () => {
			const options = parseArgs(["watch", "-b", "dist"]);
			expect(options.watch).toBe(true);
			expect(options.build).toBe("dist");
		});
	});

	describe("Error Handling & Process Exits", () => {
		it("should log an error and exit gracefully on unknown subcommands", () => {
			expect(() => parseArgs(["invalidCommand"])).toThrow();

			expect(loggerErrorSpy).toHaveBeenNthCalledWith(
				1,
				expect.stringContaining(
					'Unknown subcommand or option "invalidCommand"'
				)
			);
			expect(loggerInfoSpy).toHaveBeenCalledWith(
				expect.stringContaining("Run 'rogen --help'")
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		it("should log an error and exit gracefully on unknown subcommands", () => {
			expect(() => parseArgs(["invalidCommand"])).toThrow();

			expect(loggerErrorSpy).toHaveBeenNthCalledWith(
				1,
				expect.stringContaining(
					'Unknown subcommand or option "invalidCommand"'
				)
			);
			expect(loggerInfoSpy).toHaveBeenCalledWith(
				expect.stringContaining("Run 'rogen --help'")
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});
});
