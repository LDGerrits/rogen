import {
	GlobalOptions,
	OptionDescriptor,
	hasFlag,
	parseArgs,
} from "../args.js";

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

const commands = ["build", "watch", "help", "version"];

const parse = (argv: string[]) => parseArgs(argv, optionsFor, commands);

const values = (argv: string[]) =>
	parse(argv).unwrap().options as unknown as Record<string, unknown>;

describe("parseArgs", () => {
	it("should parse a command's own options alongside the global ones", () => {
		const parsed = values(["build", "-t", "a", "--tag", "b", "--quiet"]);

		expect(parsed.tag).toEqual(["a", "b"]);
		expect(parsed.quiet).toBe(true);
	});

	it("should map positional commands correctly and attach them to the '_' array", () => {
		const { command, options } = parse(["watch", "extra_arg"]).unwrap();

		expect(command).toBe("watch");
		expect(options._).toEqual(["watch", "extra_arg"]);
	});

	it("should default to build, and let --help and --version win", () => {
		expect(parse([]).unwrap().command).toBe("build");
		expect(parse(["-t", "a"]).unwrap().command).toBe("build");
		expect(parse(["--help"]).unwrap().command).toBe("help");
		expect(parse(["build", "-v"]).unwrap().command).toBe("version");
	});

	it("should put the defaulted command first in the positionals", () => {
		expect(values(["-q"])._).toEqual(["build"]);
	});

	it("should leave the positionals empty when --help or --version picks the command", () => {
		expect(values(["--help"])._).toEqual([]);
		expect(values(["--version"])._).toEqual([]);
	});

	it("should reject --verbose together with --quiet", () => {
		const result = parse(["build", "--verbose", "-q"]);

		expect(result.isErr() && result.error.message).toContain(
			"--verbose can't be combined with --quiet"
		);
	});

	it("should name an unknown option and point at the command's help", () => {
		const result = parse(["build", "--fake-flag"]);

		expect(result.isErr() && result.error.message).toBe(
			"Unknown option '--fake-flag'. Run 'rogen help build' to see what build accepts."
		);
	});

	it("should name an unknown short option as it was typed", () => {
		const result = parse(["watch", "-w"]);

		expect(result.isErr() && result.error.message).toContain(
			"Unknown option '-w'"
		);
	});

	it("should say an option belongs to another command", () => {
		const result = parse(["watch", "--tag", "a"]);

		expect(result.isErr() && result.error.message).toBe(
			"watch doesn't take '--tag'. build does."
		);
	});

	it("should name every command that takes an option the command doesn't", () => {
		const result = parseArgs(
			["watch", "--tag", "a"],
			(command) =>
				command === "watch" ? globals : [...globals, ...buildOptions],
			commands
		);

		expect(result.isErr() && result.error.message).toBe(
			"watch doesn't take '--tag'. build, help and version do."
		);
	});

	it("should suggest the option a misspelled one is closest to", () => {
		const result = parse(["build", "--qiuet"]);

		expect(result.isErr() && result.error.message).toBe(
			"Unknown option '--qiuet'. Did you mean '--quiet'?"
		);
	});

	it("should suggest only among the command's own options", () => {
		const result = parse(["watch", "--tga", "a"]);

		expect(result.isErr() && result.error.message).toBe(
			"Unknown option '--tga'. Run 'rogen help watch' to see what watch accepts."
		);
	});

	it("should leave an unknown command to the command service", () => {
		const parsed = parse(["deploy", "--tag", "x"]).unwrap();

		expect(parsed.command).toBe("deploy");
	});

	it.each([
		[["build", "--tag"], "Option '--tag' needs a value."],
		[["build", "-t", "--quiet"], "Option '-t' needs a value."],
		[
			["build", "--quiet=yes"],
			"Option '--quiet' is a flag and takes no value.",
		],
	])("should explain a misplaced value in %j", (argv, message) => {
		const result = parse(argv);

		expect(result.isErr() && result.error.message).toBe(message);
	});

	it("should take --no-input on every command", () => {
		const parsed = parseArgs(
			["watch", "--no-input"],
			() => GlobalOptions,
			commands
		);

		expect(parsed.unwrap().options["no-input"]).toBe(true);
	});
});

describe("hasFlag", () => {
	it("should see a flag next to one the parser rejects", () => {
		expect(hasFlag(["build", "--json", "--bogus"], "--json")).toBe(true);
	});

	it("should not see a flag after --", () => {
		expect(hasFlag(["build", "--", "--json"], "--json")).toBe(false);
	});

	it("should not see a flag that is absent", () => {
		expect(hasFlag(["build", "lobby"], "--json")).toBe(false);
	});
});
