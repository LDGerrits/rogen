import { UsageError } from "../../../base/errors.js";
import {
	GlobalOptions,
	OptionDescriptor,
	JsonOption,
	hasFlag,
	parseArgs,
} from "../args.js";

const globals: OptionDescriptor[] = [
	{ name: "verbose", short: "v", type: "boolean", description: "" },
	{ name: "help", short: "h", type: "boolean", description: "" },
	{ name: "version", short: "V", type: "boolean", description: "" },
	{ name: "quiet", short: "q", type: "boolean", description: "" },
];

const buildOptions: OptionDescriptor[] = [
	{
		name: "variant",
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

const commands = ["build", "watch", "help", "init"];

const parse = (argv: string[]) => parseArgs(argv, optionsFor, commands);

const values = (argv: string[]) => parse(argv).unwrap().line.options;

const positionals = (argv: string[]) => parse(argv).unwrap().line.positionals;

describe("parseArgs", () => {
	it("should parse a command's own options alongside the global ones", () => {
		const parsed = values([
			"build",
			"--variant",
			"a",
			"--variant",
			"b",
			"--quiet",
		]);

		expect(parsed.variant).toEqual(["a", "b"]);
		expect(parsed.quiet).toBe(true);
	});

	it("should take the command from the first positional, and leave the rest", () => {
		const { command, line } = parse(["watch", "extra_arg"]).unwrap();

		expect(command).toBe("watch");
		expect(line.positionals).toEqual(["extra_arg"]);
	});

	it("should run help for a bare line, and let --help and --version win", () => {
		expect(parse([]).unwrap().command).toBe("help");
		expect(parse(["-q"]).unwrap().command).toBe("help");
		expect(parse(["--help"]).unwrap().command).toBe("help");
		expect(parse(["build", "-V"]).unwrap().command).toBe("help");
	});

	it("should read -v as --verbose and -V as --version", () => {
		expect(values(["build", "-v"]).verbose).toBe(true);
		expect(values(["build", "-V"]).version).toBe(true);
	});

	it("should leave the positionals empty for a bare line", () => {
		expect(positionals(["-q"])).toEqual([]);
	});

	it("should keep every positional when --help or --version picks the command", () => {
		expect(positionals(["--help"])).toEqual([]);
		expect(positionals(["build", "--help"])).toEqual(["build"]);
		expect(positionals(["--version"])).toEqual([]);
	});

	it("should reject --verbose together with --quiet as a usage error", () => {
		const result = parse(["build", "--verbose", "-q"]);

		expect(result.isErr() && result.error).toBeInstanceOf(UsageError);
		expect(result.isErr() && result.error.message).toContain(
			"--verbose can't be combined with --quiet"
		);
	});

	it("should name an unknown option and point at the command's help", () => {
		const result = parse(["build", "--fake-flag"]);

		expect(result.isErr() && result.error).toBeInstanceOf(UsageError);
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
		const result = parse(["watch", "--variant", "a"]);

		expect(result.isErr() && result.error.message).toBe(
			"watch doesn't take '--variant'. build does."
		);
	});

	it("should name every command that takes an option the command doesn't", () => {
		const result = parseArgs(
			["watch", "--variant", "a"],
			(command) =>
				command === "watch" ? globals : [...globals, ...buildOptions],
			commands
		);

		expect(result.isErr() && result.error.message).toBe(
			"watch doesn't take '--variant'. build, help and init do."
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

	it("should check a --help or --version line against the command it names", () => {
		expect(parse(["build", "--variant", "a", "--help"]).unwrap()).toEqual({
			command: "help",
			line: {
				positionals: ["build"],
				options: { variant: ["a"], help: true },
			},
		});
		expect(parse(["build", "--variant", "a", "-V"]).isOk()).toBe(true);
	});

	it("should ask help about help itself for 'help --help'", () => {
		expect(parse(["help", "--help"]).unwrap()).toMatchObject({
			command: "help",
			line: { positionals: ["help"] },
		});
	});

	it("should refuse a --help line with an option the named command doesn't take", () => {
		const result = parse(["watch", "--variant", "a", "--help"]);

		expect(result.isErr() && result.error.message).toBe(
			"watch doesn't take '--variant'. build does."
		);
	});

	it("should check a line without a command against help, and say an option goes after a command", () => {
		const result = parse(["--help", "--variant", "a"]);

		expect(result.isErr() && result.error.message).toBe(
			"'--variant' goes after a command: build takes it."
		);
	});

	it("should pass everything after the first -- through untouched", () => {
		const { line } = parse([
			"watch",
			"lobby",
			"--",
			"--port",
			"34873",
			"--",
			"x",
		]).unwrap();

		expect(line.positionals).toEqual(["lobby"]);
		expect(line.passthrough).toEqual(["--port", "34873", "--", "x"]);
	});

	it("should not read options after -- as its own", () => {
		const { line } = parse(["watch", "--", "--quiet"]).unwrap();

		expect(line.options.quiet).toBeUndefined();
		expect(line.passthrough).toEqual(["--quiet"]);
	});

	it("should give no passthrough to a line without --", () => {
		const { line } = parse(["watch", "lobby"]).unwrap();

		expect(line.passthrough).toBeUndefined();
	});

	it("should leave an unknown command to the command service", () => {
		const parsed = parse(["deploy", "--variant", "x"]).unwrap();

		expect(parsed.command).toBe("deploy");
	});

	it.each([
		[["build", "--variant"], "Option '--variant' needs a value."],
		[
			["build", "--quiet=yes"],
			"Option '--quiet' is a flag and takes no value.",
		],
	])("should explain a misplaced value in %j", (argv, message) => {
		const result = parse(argv);

		expect(result.isErr() && result.error.message).toBe(message);
	});

	it.each([["--no-input"], ["--all"], ["-c", "x"]])(
		"should reject %s, which no command takes",
		(...flag) => {
			const result = parseArgs(
				["build", ...flag],
				() => GlobalOptions,
				commands
			);

			expect(result.isErr() && result.error).toBeInstanceOf(UsageError);
		}
	);
});

describe("hasFlag", () => {
	it("should see a flag next to one the parser rejects", () => {
		expect(hasFlag(["build", "--json", "--bogus"], JsonOption)).toBe(true);
	});

	it("should not see a flag after --", () => {
		expect(hasFlag(["build", "--", "--json"], JsonOption)).toBe(false);
	});

	it("should not see a flag that is absent", () => {
		expect(hasFlag(["build", "lobby"], JsonOption)).toBe(false);
	});
});
