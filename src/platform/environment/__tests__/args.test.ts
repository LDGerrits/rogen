import { parseArgs } from "../args.js";

describe("CLI Argument Parsing", () => {
	it("should parse full flags correctly alongside a command", () => {
		const args = [
			"build",
			"--profile",
			"prod",
			"--source",
			"my_src",
			"--quiet",
		];
		const { command, options } = parseArgs(args).unwrap();

		expect(command).toBe("build");
		expect(options.profile).toEqual("prod");
		expect(options.source).toEqual(["my_src"]);
		expect(options.quiet).toBe(true);
	});

	it("should map positional commands correctly and attach them to the '_' array", () => {
		const { command, options } = parseArgs(["watch", "extra_arg"]).unwrap();

		expect(command).toBe("watch");
		expect(options._).toEqual(["watch", "extra_arg"]);
	});

	it("should return an error on unknown options", () => {
		const result = parseArgs(["build", "--fake-flag"]);

		expect(result.isErr()).toBe(true);

		if (!result.isErr()) {
			throw new Error("Expected an error result but got ok.");
		}

		expect(result.error.message).toContain("Unknown option");
	});
});
