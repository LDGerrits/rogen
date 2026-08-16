import { parseArgs } from "../args.js";

describe("CLI Argument Parsing", () => {
	describe("Flag Parsing", () => {
		it("should parse full flags correctly alongside a command", () => {
			const args = [
				"build",
				"--mode",
				"ts",
				"--source",
				"my_src",
				"--quiet",
			];
			const { command, options } = parseArgs(args).unwrap();

			expect(command).toBe("build");
			expect(options.mode).toEqual(["ts"]);
			expect(options.source).toEqual(["my_src"]);
			expect(options.quiet).toBe(true);
		});

		it("should parse short aliases correctly", () => {
			const args = ["watch", "-m", "luau", "-s", "other_src", "-q"];
			const { command, options } = parseArgs(args).unwrap();

			expect(command).toBe("watch");
			expect(options.mode).toEqual(["luau"]);
			expect(options.source).toEqual(["other_src"]);
			expect(options.quiet).toBe(true);
		});

		it("should parse multiple array flags correctly", () => {
			const args = [
				"build",
				"-s",
				"src/core",
				"-s",
				"src/chapter1",
				"-e",
				"dev",
				"--env",
				"prod",
			];
			const { options } = parseArgs(args).unwrap();

			expect(options.source).toEqual(["src/core", "src/chapter1"]);
			expect(options.env).toEqual(["dev", "prod"]);
		});
	});

	describe("Subcommand Positional Mapping", () => {
		it("should map the 'init' positional to the command string", () => {
			const { command } = parseArgs(["init"]).unwrap();
			expect(command).toBe("init");
		});

		it("should map the 'watch' positional correctly alongside flags", () => {
			const { command, options } = parseArgs([
				"watch",
				"-b",
				"dist",
			]).unwrap();
			expect(command).toBe("watch");
			expect(options.build).toBe("dist");
		});

		it("should default to 'help' if no command is provided", () => {
			const { command } = parseArgs([]).unwrap();
			expect(command).toBe("help");
		});
	});

	describe("Error Handling", () => {
		it("should pass unknown subcommands as strings to be rejected by the registry", () => {
			const { command } = parseArgs(["invalidCommand"]).unwrap();
			expect(command).toBe("invalidcommand");
		});

		it("should return an error on unknown flags", () => {
			const result = parseArgs(["build", "--unknown-flag"]);

			expect(result.isErr()).toBe(true);

			if (!result.isErr()) {
				throw new Error("Expected an error result but got ok.");
			}

			expect(result.error.message).toContain("Unknown option");
		});
	});
});
