import { OptionDescriptor, parseArgs } from "../args.js";

const globals: OptionDescriptor[] = [
	{ name: "verbose", type: "boolean", description: "" },
	{ name: "help", short: "h", type: "boolean", description: "" },
	{ name: "version", short: "v", type: "boolean", description: "" },
	{ name: "quiet", short: "q", type: "boolean", description: "" },
];

const buildOptions: OptionDescriptor[] = [
	{
		name: "tag",
		short: "t",
		type: "string",
		multiple: true,
		description: "",
	},
];

const optionsFor = (command?: string) =>
	command === undefined || command === "build"
		? [...globals, ...buildOptions]
		: globals;

const values = (argv: string[]) =>
	parseArgs(argv, optionsFor).unwrap().options as unknown as Record<
		string,
		unknown
	>;

describe("parseArgs", () => {
	it("should parse a command's own options alongside the global ones", () => {
		const parsed = values(["build", "-t", "a", "--tag", "b", "--quiet"]);

		expect(parsed.tag).toEqual(["a", "b"]);
		expect(parsed.quiet).toBe(true);
	});

	it("should map positional commands correctly and attach them to the '_' array", () => {
		const { command, options } = parseArgs(
			["watch", "extra_arg"],
			optionsFor
		).unwrap();

		expect(command).toBe("watch");
		expect(options._).toEqual(["watch", "extra_arg"]);
	});

	it("should default to build, and let --help and --version win", () => {
		expect(parseArgs([], optionsFor).unwrap().command).toBe("build");
		expect(parseArgs(["-t", "a"], optionsFor).unwrap().command).toBe(
			"build"
		);
		expect(parseArgs(["--help"], optionsFor).unwrap().command).toBe("help");
		expect(parseArgs(["build", "-v"], optionsFor).unwrap().command).toBe(
			"version"
		);
	});

	it("should put the defaulted command first in the positionals", () => {
		expect(values(["-q"])._).toEqual(["build"]);
	});

	it("should reject --verbose together with --quiet", () => {
		const result = parseArgs(["build", "--verbose", "-q"], optionsFor);

		expect(result.isErr() && result.error.message).toContain(
			"--verbose can't be combined with --quiet"
		);
	});

	it("should return an error naming an unknown option", () => {
		const result = parseArgs(["build", "--fake-flag"], optionsFor);

		expect(result.isErr()).toBe(true);
		expect(result.isErr() && result.error.message).toContain("--fake-flag");
	});

	it("should reject an option that belongs to another command", () => {
		const result = parseArgs(["watch", "--tag", "a"], optionsFor);

		expect(result.isErr()).toBe(true);
		expect(result.isErr() && result.error.message).toContain("--tag");
	});
});
