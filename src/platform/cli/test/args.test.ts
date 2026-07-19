import { parseArgs } from "../args.js";

describe("CLI Argument Parsing", () => {
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
			const options = parseArgs(args).unwrap();

			expect(options.mode).toEqual(["ts"]);
			expect(options.source).toEqual(["my_src"]);
			expect(options.watch).toBe(true);
			expect(options.quiet).toBe(true);
		});

		it("should parse short aliases correctly", () => {
			const args = ["-m", "luau", "-s", "other_src", "-w", "-q"];
			const options = parseArgs(args).unwrap();

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
			const options = parseArgs(args).unwrap();

			expect(options.source).toEqual(["src/core", "src/chapter1"]);
			expect(options.env).toEqual(["dev", "prod"]);
		});
	});

	describe("Subcommand Positional Mapping", () => {
		it("should map the 'init' positional correctly", () => {
			const options = parseArgs(["init"]).unwrap();
			expect(options.init).toBe(true);
		});

		it("should map the 'watch' positional correctly alongside flags", () => {
			const options = parseArgs(["watch", "-b", "dist"]).unwrap();
			expect(options.watch).toBe(true);
			expect(options.build).toBe("dist");
		});
	});

	describe("Error Handling", () => {
		it("should return an error on unknown subcommands", () => {
			const result = parseArgs(["invalidCommand"]);

			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.message).toContain(
					'Unknown subcommand or option "invalidCommand"'
				);
			}
		});

		it("should return an error on unknown flags", () => {
			const result = parseArgs(["--unknown-flag"]);

			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error.message).toContain("Unknown option");
			}
		});
	});
});
