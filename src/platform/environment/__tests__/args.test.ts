import { UsageError } from "../../../base/errors.js";
import {
	GlobalOptions,
	OptionDescriptor,
	JsonOption,
	ColorOption,
	hasFlag,
	choiceIn,
	parseArgs,
} from "../args.js";

const globals: OptionDescriptor[] = [
	{
		name: "verbose",
		short: "v",
		type: "boolean",
		multiple: true,
		description: "",
	},
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
	{ name: "hook", type: "boolean", negatable: true, description: "" },
	{ name: "dry", type: "boolean", description: "" },
	{ name: "cache", type: "boolean", negatedOnly: true, description: "" },
	{
		name: "assume",
		short: "y",
		aliases: ["yes"],
		type: "boolean",
		description: "",
	},
	{
		name: "listing",
		type: "string",
		values: ["glob", "folder", "file"],
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

	describe("a negatable flag", () => {
		it("should be true when given and false when negated", () => {
			expect(values(["build", "--hook"]).hook).toBe(true);
			expect(values(["build", "--no-hook"]).hook).toBe(false);
			expect(values(["build"]).hook).toBeUndefined();
		});

		it("should not be negated when it isn't declared negatable", () => {
			const result = parse(["build", "--no-dry"]);

			expect(result.isErr() && result.error.message).toBe(
				"Unknown option '--no-dry'. Did you mean '--dry'?"
			);
		});

		it("should still be an unknown option when no flag has the name", () => {
			const result = parse(["build", "--no-variant"]);

			expect(result.isErr() && result.error.message).toContain(
				"Unknown option '--no-variant'."
			);
		});
	});

	describe("a flag that only opts out", () => {
		it("should be false when given as --no- and not given otherwise", () => {
			expect(values(["build", "--no-cache"]).cache).toBe(false);
			expect(values(["build"]).cache).toBeUndefined();
		});

		it("should refuse the positive form, saying it is the default", () => {
			const result = parse(["build", "--cache"]);

			expect(result.isErr() && result.error).toBeInstanceOf(UsageError);
			expect(result.isErr() && result.error.message).toBe(
				"'--cache' is what build does already; only '--no-cache' changes it."
			);
		});
	});

	describe("an option with values", () => {
		it("should take one of them", () => {
			expect(values(["build", "--listing", "glob"]).listing).toBe("glob");
		});

		it("should refuse another as a usage error, naming the values with the closest first", () => {
			const result = parse(["build", "--listing", "flder"]);

			expect(result.isErr() && result.error).toBeInstanceOf(UsageError);
			expect(result.isErr() && result.error).toMatchObject({
				reason: "'flder' is not a value of '--listing'.",
				hint: "The values are folder, glob and file.",
			});
		});
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
		expect(values(["build", "-v"]).verbose).toEqual([true]);
		expect(values(["build", "-V"]).version).toBe(true);
	});

	it("should count -v each time it is given", () => {
		expect(values(["build", "-vv"]).verbose).toEqual([true, true]);
		expect(values(["-v", "build", "--verbose"]).verbose).toEqual([
			true,
			true,
		]);
	});

	it("should leave an alias unknown on a command that has no such option", () => {
		const result = parse(["init", "--yes"]);

		expect(result.isErr() && result.error.message).toContain(
			"Unknown option '--yes'."
		);
	});

	it("should read an alias as the option it names", () => {
		expect(values(["build", "--yes"]).assume).toBe(true);
		expect(values(["build", "-y"]).assume).toBe(true);
		expect(values(["build", "--yes", "--", "--yes"]).assume).toBe(true);
		expect(
			parse(["build", "--yes", "--", "--yes"]).unwrap().line.passthrough
		).toEqual(["--yes"]);
	});

	it("should mark a line with no command, --help or --version as bare", () => {
		expect(parse([]).unwrap().bare).toBe(true);
		expect(parse(["-q"]).unwrap().bare).toBe(true);
		expect(parse(["--help"]).unwrap().bare).toBe(false);
		expect(parse(["-V"]).unwrap().bare).toBe(false);
		expect(parse(["help"]).unwrap().bare).toBe(false);
		expect(parse(["build"]).unwrap().bare).toBe(false);
	});

	it("should leave the positionals empty for a bare line", () => {
		expect(positionals(["-q"])).toEqual([]);
	});

	it("should keep every positional when --help or --version picks the command", () => {
		expect(positionals(["--help"])).toEqual([]);
		expect(positionals(["build", "--help"])).toEqual(["build"]);
		expect(positionals(["--version"])).toEqual([]);
	});

	it("should pass help only the command name when --help follows an argument", () => {
		expect(positionals(["build", "game", "--help"])).toEqual(["build"]);
		expect(positionals(["build", "game", "-h"])).toEqual(["build"]);
		expect(positionals(["--help", "build", "game"])).toEqual(["build"]);
		expect(positionals(["help", "codes", "route", "-h"])).toEqual(["help"]);
		expect(positionals(["help", "codes", "route"])).toEqual([
			"codes",
			"route",
		]);
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
			bare: false,
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
			"'--variant' goes after a command. build takes it."
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
		[["build", "--variant", ""], "Option '--variant' needs a value."],
		[
			["build", "--quiet=yes"],
			"Option '--quiet' is a flag and takes no value.",
		],
	])("should explain a misplaced value in %j", (argv, message) => {
		const result = parse(argv);

		expect(result.isErr() && result.error.message).toBe(message);
	});

	it("should read -t=mock as -t mock, as Rojo does", () => {
		const { line } = parse(["build", "-t=mock"]).unwrap();

		expect(line.options.variant).toEqual(["mock"]);
	});

	it("should keep a value that starts with a dash, after -t=", () => {
		const { line } = parse(["build", "-t=-x"]).unwrap();

		expect(line.options.variant).toEqual(["-x"]);
	});

	it("should keep an = in the value of a short option", () => {
		const { line } = parse(["build", "-t=a=b"]).unwrap();

		expect(line.options.variant).toEqual(["a=b"]);
	});

	it("should not rewrite -t=mock after --", () => {
		const { line } = parse(["build", "--", "-t=mock"]).unwrap();

		expect(line.passthrough).toEqual(["-t=mock"]);
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

describe("choiceIn", () => {
	it("should read a choice next to an option the parser rejects", () => {
		expect(
			choiceIn(["build", "--color", "never", "--bogus"], ColorOption)
		).toBe("never");
		expect(
			choiceIn(["build", "--color=always", "--bogus"], ColorOption)
		).toBe("always");
	});

	it("should read nothing for a value that isn't a choice, or after --", () => {
		expect(
			choiceIn(["build", "--color", "blue"], ColorOption)
		).toBeUndefined();
		expect(
			choiceIn(["serve", "--", "--color", "never"], ColorOption)
		).toBeUndefined();
	});
});
