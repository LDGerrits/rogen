import { parseCliArgs } from "../src/cli.js";
import { jest } from "@jest/globals";

describe("CLI Argument Parsing", () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	describe("Flag Parsing", () => {
		it("should parse full flags correctly", () => {
			const args = ["--mode", "ts", "--source", "my_src", "--watch"];
			const options = parseCliArgs(args);

			expect(options.mode).toEqual(["ts"]);
			expect(options.source).toEqual(["my_src"]);
			expect(options.watch).toBe(true);
		});

		it("should parse short aliases correctly", () => {
			const args = ["-m", "luau", "-s", "other_src", "-w"];
			const options = parseCliArgs(args);

			expect(options.mode).toEqual(["luau"]);
			expect(options.source).toEqual(["other_src"]);
			expect(options.watch).toBe(true);
		});

		it("should parse multiple source flags correctly", () => {
			const args = ["-s", "src/core", "-s", "src/chapter1"];
			const options = parseCliArgs(args);

			expect(options.source).toEqual(["src/core", "src/chapter1"]);
		});

		it("should return undefined for omitted flags", () => {
			const args = ["--mode", "darklua"];
			const options = parseCliArgs(args);

			expect(options.mode).toEqual(["darklua"]);
			expect(options.watch).toBeUndefined();
		});

		it("should parse multiple active environment flags correctly", () => {
			const args = ["-f", "dev", "--flag", "debug"];
			const options = parseCliArgs(args);

			expect(options.flag).toEqual(["dev", "debug"]);
		});

		it("should parse build directory overrides correctly", () => {
			const args1 = ["--build", "dist"];
			const options1 = parseCliArgs(args1);
			expect(options1.build).toBe("dist");

			const args2 = ["-b", "custom_out"];
			const options2 = parseCliArgs(args2);
			expect(options2.build).toBe("custom_out");
		});

		it("should parse the legacy help/version flags correctly", () => {
			const optionsHelp = parseCliArgs(["--help"]);
			expect(optionsHelp.help).toBe(true);

			const optionsVersion = parseCliArgs(["-v"]);
			expect(optionsVersion.version).toBe(true);
		});
	});

	describe("Subcommand Positionals", () => {
		it("should parse the 'init' subcommand positional correctly", () => {
			const options = parseCliArgs(["init"]);
			expect(options.init).toBe(true);
		});

		it("should parse the 'watch' subcommand positional correctly", () => {
			const options = parseCliArgs(["watch"]);
			expect(options.watch).toBe(true);
		});

		it("should parse the 'help' subcommand positional correctly", () => {
			const options = parseCliArgs(["help"]);
			expect(options.help).toBe(true);
		});

		it("should parse the 'version' subcommand positional correctly", () => {
			const options = parseCliArgs(["version"]);
			expect(options.version).toBe(true);
		});

		it("should support combining a subcommand positional with options", () => {
			const options = parseCliArgs(["watch", "-b", "dist", "-f", "prod"]);
			expect(options.watch).toBe(true);
			expect(options.build).toBe("dist");
			expect(options.flag).toEqual(["prod"]);
		});
	});

	describe("Error Handling", () => {
		it("should catch unknown arguments and exit gracefully with an error message", () => {
			const exitSpy = jest
				.spyOn(process, "exit")
				.mockImplementation((() => {}) as any);
			const errorSpy = jest
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const args = ["--unknown", "value"];
			parseCliArgs(args);

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Unknown option '--unknown'")
			);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Run 'rogen --help'")
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		it("should exit gracefully when an invalid subcommand positional is passed", () => {
			const exitSpy = jest
				.spyOn(process, "exit")
				.mockImplementation((() => {}) as any);
			const errorSpy = jest
				.spyOn(console, "error")
				.mockImplementation(() => {});

			parseCliArgs(["invalidSubcommand"]);

			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("unknown subcommand")
			);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Run 'rogen --help'")
			);
			expect(exitSpy).toHaveBeenCalledWith(1);
		});
	});
});
