import { OptionDescriptor, parseArgs } from "../args.js";

const options: OptionDescriptor[] = [
	{ name: "help", short: "h", type: "boolean", description: "" },
	{ name: "version", short: "v", type: "boolean", description: "" },
	{ name: "quiet", short: "q", type: "boolean", description: "" },
	{
		name: "source",
		short: "s",
		type: "string",
		multiple: true,
		description: "",
	},
	{ name: "output", type: "string", description: "" },
];

describe("parseArgs", () => {
	it("should parse the options it is given alongside a command", () => {
		const { command, options: parsed } = parseArgs(
			["build", "--output", "out", "-s", "a", "--source", "b", "--quiet"],
			options
		).unwrap();

		expect(command).toBe("build");
		expect(parsed.output).toBe("out");
		expect(parsed.source).toEqual(["a", "b"]);
		expect(parsed.quiet).toBe(true);
	});

	it("should map positional commands correctly and attach them to the '_' array", () => {
		const { command, options: parsed } = parseArgs(
			["watch", "extra_arg"],
			options
		).unwrap();

		expect(command).toBe("watch");
		expect(parsed._).toEqual(["watch", "extra_arg"]);
	});

	it("should default to help, and let --version win", () => {
		expect(parseArgs([], options).unwrap().command).toBe("help");
		expect(parseArgs(["build", "-v"], options).unwrap().command).toBe(
			"version"
		);
	});

	it("should return an error naming an unknown option", () => {
		const result = parseArgs(["build", "--fake-flag"], options);

		expect(result.isErr()).toBe(true);
		expect(result.isErr() && result.error.message).toContain("--fake-flag");
	});

	it("should reject an option that is not in the table", () => {
		expect(parseArgs(["build", "--output", "x"], []).isErr()).toBe(true);
	});
});
