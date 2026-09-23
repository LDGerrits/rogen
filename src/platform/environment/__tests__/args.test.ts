import {
	OptionDescriptor,
	OptionValues,
	ParsedArgs,
	parseArgs,
} from "../args.js";

const globals: OptionDescriptor[] = [
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

	it("should default to help, and let --version win", () => {
		expect(parseArgs([], optionsFor).unwrap().command).toBe("help");
		expect(parseArgs(["build", "-v"], optionsFor).unwrap().command).toBe(
			"version"
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

describe("ParsedArgs", () => {
	it("should type every global option by its declaration", () => {
		const args: ParsedArgs = {
			_: [],
			help: true,
			config: "a.rogen.json",
			verbose: false,
		};
		// @ts-expect-error `config` is declared as a string
		const wrong: ParsedArgs = { _: [], config: true };
		// @ts-expect-error `nope` is not a declared option
		const unknown: ParsedArgs = { _: [], nope: true };

		expect([args, wrong, unknown]).toHaveLength(3);
	});

	it("should type a command's own options with OptionValues", () => {
		const _options = [
			{ name: "tag", type: "string", multiple: true, description: "" },
			{ name: "dry", type: "boolean", description: "" },
		] as const satisfies readonly OptionDescriptor[];
		const values: OptionValues<typeof _options> = {
			tag: ["a"],
			dry: true,
		};
		// @ts-expect-error `tag` is repeatable, so it is a string[]
		const wrong: OptionValues<typeof _options> = { tag: "a" };

		expect([values, wrong]).toHaveLength(2);
	});
});
