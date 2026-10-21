import { jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MockProductService } from "../../../platform/product/__tests__/mock-product-service.js";
import {
	CommandHarness,
	commandHarness,
	parseCommandLine,
} from "../../__tests__/command-harness.js";
import "../../build/build-command.js";
import "../../check/check-command.js";
import "../../fmt-project/fmt-project-command.js";
import "../doc-command.js";
import "../help-command.js";
import "../../init/init-command.js";
import "../../list/list-command.js";
import "../../plugin/plugin-command.js";
import "../../serve/serve-command.js";
import "../../sourcemap/sourcemap-command.js";
import "../../syncback/syncback-command.js";
import "../../upload/upload-command.js";
import "../../where/where-command.js";
import { DisposableStore } from "../../../base/disposable.js";
import { UsageError } from "../../../base/errors.js";
import { Result, ResultError, ok } from "../../../base/result.js";
import {
	AbstractCommand,
	CommandRegistry,
	Extensions,
	registerCommand,
} from "../../../platform/commands/commands.js";
import {
	GlobalOptions,
	OptionDescriptor,
} from "../../../platform/environment/args.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { Registry } from "../../../platform/registry/registry.js";
import { helpTexts } from "../help-texts.js";

const flagText = (option: OptionDescriptor) =>
	option.negatable ? `[no-]${option.name}` : option.name;

describe("help command", () => {
	const registry = Registry.as<CommandRegistry>(Extensions.Commands);
	let store: DisposableStore;
	let logService: NullLogService;
	let info: ReturnType<typeof jest.spyOn>;
	let harness: CommandHarness<NullLogService>;

	const help = (...positionals: string[]) =>
		harness.run("help", { positionals });

	const printed = () => String(info.mock.calls[0][0]);

	beforeEach(() => {
		store = new DisposableStore();
		logService = new NullLogService();
		info = jest.spyOn(logService, "print");
		harness = commandHarness({
			log: logService,
			product: new MockProductService("2.3.4"),
		});
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should have imported every command module, so the tests below cover them all", () => {
		const commandFiles = fs
			.readdirSync("src/commands", { recursive: true, encoding: "utf8" })
			.map((file) => path.basename(file))
			.filter((file) => file.endsWith("-command.ts"))
			.map((file) => file.slice(0, -"-command.ts".length));

		expect([...registry.getCommands().keys()].sort()).toEqual(
			commandFiles.sort()
		);
	});

	describe("rogen help", () => {
		it("should list every global option", async () => {
			await help();

			for (const option of GlobalOptions) {
				expect(printed()).toContain(`--${option.name}`);
			}
		});

		it("should end with the exit codes", async () => {
			await help();

			expect(
				printed().trimEnd().split("\n\n").at(-1)?.replace(/\n/g, " ")
			).toBe(
				"Exit codes: 0 done (warnings included), 1 the project has errors, 2 the command line is wrong. 'check' also exits 1 on a warning."
			);
		});

		it("should print the version for --version, whatever the command", async () => {
			await harness.run("help", {
				positionals: ["build"],
				options: { version: true, help: true },
			});

			expect(printed()).toBe("rogen 2.3.4");
		});
	});

	describe("the layout", () => {
		const section = (text: string, title: string) => {
			const lines = text.split("\n");
			const start = lines.indexOf(`${title}:`);
			const rest = lines.slice(start + 1);
			const end = rest.indexOf("");
			return rest.slice(0, end === -1 ? undefined : end);
		};

		it("should head the root help with its description, USAGE, OPTIONS, SUBCOMMANDS and EXAMPLES in order", async () => {
			await help();

			const titles = printed()
				.split("\n")
				.filter((line) => /^[A-Z]+:$/.test(line));
			expect(titles).toEqual([
				"USAGE:",
				"OPTIONS:",
				"SUBCOMMANDS:",
				"EXAMPLES:",
			]);
			expect(printed().split("\n").slice(0, 2)).toEqual([
				"rogen",
				"Feature-based architecture for Roblox",
			]);
			expect(section(printed(), "USAGE")).toEqual([
				"    rogen [OPTIONS] <SUBCOMMAND>",
			]);
		});

		it("should list the subcommands by name", async () => {
			await help();

			const names = section(printed(), "SUBCOMMANDS").map(
				(line) => line.trim().split(/\s+/)[0]
			);
			expect(names).toEqual([...registry.getCommands().keys()].sort());
		});

		it("should list each subcommand with its summary on one line", async () => {
			await help();

			expect(
				section(printed(), "SUBCOMMANDS").map((line) =>
					line.trim().split(/ {2,}/)
				)
			).toEqual(
				[...registry.getCommands().values()]
					.sort((a, b) => (a.id < b.id ? -1 : 1))
					.map((command) => [command.id, command.metadata.summary])
			);
		});

		it("should give every command a summary short enough for one line", () => {
			for (const command of registry.getCommands().values())
				expect(command.metadata.summary).toMatch(
					/^[A-Z][^\n]{0,58}[^.\n]$/
				);
		});

		it.each(["", "build", "serve", "init"])(
			"should keep every line of %j within 100 columns, carrying a long text on under its column",
			async (target) => {
				await help(...(target ? [target] : []));

				const examples = section(printed(), "EXAMPLES");
				const tooLong = printed()
					.split("\n")
					.filter(
						(line) => line.length > 100 && !examples.includes(line)
					);
				expect(tooLong).toEqual([]);
				const options = section(printed(), "OPTIONS");
				const column = /^ +\S.*? {4,}(?=\S)/.exec(options[0])![0]
					.length;
				for (const line of options.filter(
					(line) => !/^ {4}(-| {4}-)/.test(line)
				))
					expect(line.search(/\S/)).toBe(column);
			}
		);

		it("should wrap a code's prose at 100 columns and keep its quoted lines whole", async () => {
			await help("route.strayAt");

			const lines = printed().split("\n");
			expect(
				lines.filter(
					(line) => line.length > 100 && !line.startsWith(" ")
				)
			).toEqual([]);
			expect(lines).toContain(
				'  default.rogen.json - warning: 2 names have an "@" that routes nowhere, so they are read as ordinary names: (route.strayAt)'
			);
		});

		it("should list every code with its severity and meaning, wrapped under the code", async () => {
			await help("codes");

			const lines = printed().split("\n");
			const starts = lines.filter((line) => !line.startsWith(" "));
			expect(starts.map((line) => line.split(/\s/)[0])).toEqual(
				Object.keys(helpTexts.diagnostics)
			);
			expect(lines.every((line) => line.length <= 100)).toBe(true);
			expect(
				starts.find((line) => line.startsWith("config.unknownField"))
			).toMatch(
				/^config\.unknownField +error +The config has a key that is neither one of Rojo's/
			);
			expect(
				starts.find((line) =>
					line.startsWith("roblox.unsupportedService")
				)
			).toMatch(/^roblox\.unsupportedService +error /);
		});

		it("should merge the global options into a command's, sorted by name", async () => {
			await help("build");

			const names = section(printed(), "OPTIONS").flatMap((line) => {
				const name = /^ {4}(?:-\w, | {4})--([a-z-]+)/.exec(line)?.[1];
				return name === undefined ? [] : [name];
			});
			expect(names).toEqual([...names].sort());
			expect(names).toEqual(
				expect.arrayContaining(["color", "help", "output", "version"])
			);
		});

		it("should show a value's capitalised name, its default and its possible values", async () => {
			await help("build");

			expect(printed().replace(/\n +/g, " ")).toMatch(
				/--color <COLOR> +Whether to colour the output\. \[default: auto\] \[possible values: auto, always, never\]/
			);
			expect(printed()).toMatch(/-o, --output <OUTPUT> /);
		});

		it("should line up a long-only option under the short ones", async () => {
			await help("build");

			expect(section(printed(), "OPTIONS")).toEqual(
				expect.arrayContaining([
					expect.stringMatching(/^ {4}-h, --help /),
					expect.stringMatching(/^ {8}--color /),
				])
			);
		});

		it("should list a command's subcommands in place of an argument", async () => {
			await help("plugin");

			expect(section(printed(), "USAGE")).toEqual([
				"    rogen plugin [OPTIONS] <SUBCOMMAND>",
			]);
			expect(printed()).not.toContain("ARGS:");
			expect(
				section(printed(), "SUBCOMMANDS").map(
					(line) => line.trim().split(/\s+/)[0]
				)
			).toEqual(["install", "uninstall"]);
		});

		it("should leave out a section that has nothing to list", async () => {
			await help("list");

			expect(printed()).not.toContain("SUBCOMMANDS:");
		});

		it("should print the same for 'help build', 'build --help' and 'build -h'", async () => {
			const texts: string[] = [];
			for (const argv of [
				["help", "build"],
				["build", "--help"],
				["build", "-h"],
			]) {
				info.mockClear();
				const { command, line } = parseCommandLine(...argv).unwrap();
				await harness.run(command, line);
				texts.push(printed());
			}

			expect(texts[1]).toBe(texts[0]);
			expect(texts[2]).toBe(texts[0]);
		});
	});

	describe("rogen help <command>", () => {
		it("should print the command's usage and arguments", async () => {
			await help("build");

			const [head, usage] = printed().split("\n\n");
			const [title, ...description] = head.split("\n");
			expect(title).toBe("rogen-build");
			expect(description.join(" ")).toBe(
				registry.getCommand("build")?.metadata.description
			);
			expect(usage).toBe("USAGE:\n    rogen build [OPTIONS] [PROJECT]");
			expect(printed()).toContain("<PROJECT>");
			expect(printed()).toContain("A folder, a .rogen.json file");
		});

		it("should give every command examples, after its options", async () => {
			for (const command of registry.getCommands().values()) {
				info.mockClear();
				await help(command.id);

				const text = printed();
				expect(
					command.metadata.examples?.length
				).toBeGreaterThanOrEqual(2);
				expect(text).toContain(
					`EXAMPLES:\n    ${command.metadata.examples?.[0]}`
				);
				expect(text.indexOf("EXAMPLES:")).toBeGreaterThan(
					text.indexOf("OPTIONS:")
				);
			}
		});

		it("should resolve the command from --help as well", async () => {
			await harness.run("help", {
				positionals: ["build"],
				options: { help: true },
			});

			expect(printed()).toContain("rogen build");
		});

		it("should return an error naming an unknown command", async () => {
			const result = await help("prod");

			expect((result as ResultError<Error>).error).toBeInstanceOf(
				UsageError
			);
			expect((result as ResultError<Error>).error.message).toContain(
				'Unknown command "prod"'
			);
		});

		it("should suggest the command a misspelled one is closest to", async () => {
			const result = await help("bulid");

			expect((result as ResultError<Error>).error.message).toBe(
				"Unknown command \"bulid\". Did you mean 'rogen help build'?"
			);
		});
	});

	describe("a diagnostic code named without its module", () => {
		it("should print the one code it is the end of, in any case", async () => {
			for (const name of ["strayAt", "strayat", "STRAYAT"]) {
				info.mockClear();
				const result = await help(name);

				expect(result.isOk()).toBe(true);
				expect(printed().split("\n")[0]).toBe("route.strayAt");
			}
		});

		it("should suggest the code a misspelled end is closest to", async () => {
			const result = await help("strayAd");

			expect((result as ResultError<Error>).error.message).toContain(
				"Did you mean 'rogen help route.strayAt'?"
			);
		});

		it("should suggest rather than print when several codes end in the name", async () => {
			const result = await help("invalidSyntax");

			expect((result as ResultError<Error>).error.message).toContain(
				"Did you mean"
			);
			expect(info).not.toHaveBeenCalled();
		});
	});

	describe("rogen help <topic>", () => {
		it.each(["routing", "Config"])(
			"should point %s to rogen doc rather than print it",
			async (topic) => {
				const result = await help(topic);

				expect(result.isErr()).toBe(true);
				expect((result as ResultError<Error>).error).toBeInstanceOf(
					UsageError
				);
				expect((result as ResultError<Error>).error.message).toBe(
					`"${topic}" is a topic, not a command. Run 'rogen doc ${topic.toLowerCase()}'.`
				);
				expect(info).not.toHaveBeenCalled();
			}
		);

		it("should list no topic in the overview", async () => {
			await help();

			expect(printed()).not.toContain("Topics:");
			expect(printed()).toContain("'rogen doc <topic>'");
		});

		it("should name no topic after a command", () => {
			const commands = [...registry.getCommands().keys()];

			expect(
				Object.keys(helpTexts.topics).filter((topic) =>
					commands.includes(topic)
				)
			).toEqual([]);
		});
	});

	describe("rogen help <code>", () => {
		it("should print the code's section, headed by the code", async () => {
			await help("route.strayAt");

			expect(printed().split("\n")[0]).toBe("route.strayAt");
			expect(printed()).toContain("Warning.");
		});

		it("should print the code written in another case", async () => {
			await help("route.strayat");

			expect(printed().split("\n")[0]).toBe("route.strayAt");
		});

		it("should suggest the code a misspelled one is closest to", async () => {
			const result = await help("route.strayAd");

			expect((result as ResultError<Error>).error.message).toBe(
				"Unknown diagnostic code \"route.strayAd\". Did you mean 'rogen help route.strayAt'?"
			);
		});
	});

	describe("option table", () => {
		it("should write an option's placeholder after it", async () => {
			const options = [
				{
					name: "thing",
					short: "t",
					type: "string",
					placeholder: "path",
					description: "Takes a thing.",
				},
			] as const satisfies readonly OptionDescriptor[];
			store.add(
				registerCommand(
					class extends AbstractCommand<typeof options> {
						constructor() {
							super({
								id: "placeholder",
								metadata: {
									summary: "Does a thing",
									description: "A test command.",
									options,
								},
							});
						}

						async run(): Promise<Result<void, Error>> {
							return ok(undefined);
						}
					}
				)
			);

			await help("placeholder");

			expect(printed()).toContain("-t, --thing <PATH>");
		});

		it("should write the capitalised name for a string option without a placeholder", async () => {
			const options = [
				{
					name: "thing",
					type: "string",
					description: "Takes a thing.",
				},
			] as const satisfies readonly OptionDescriptor[];
			store.add(
				registerCommand(
					class extends AbstractCommand<typeof options> {
						constructor() {
							super({
								id: "placeholder-fallback",
								metadata: {
									summary: "Does a thing",
									description: "A test command.",
									options,
								},
							});
						}

						async run(): Promise<Result<void, Error>> {
							return ok(undefined);
						}
					}
				)
			);

			await help("placeholder-fallback");

			expect(printed()).toContain("--thing <THING>");
		});

		it("should mark an option that may repeat", async () => {
			const options = [
				{
					name: "thing",
					type: "string",
					multiple: true,
					description: "Takes things.",
				},
			] as const satisfies readonly OptionDescriptor[];
			store.add(
				registerCommand(
					class extends AbstractCommand<typeof options> {
						constructor() {
							super({
								id: "repeatable",
								metadata: {
									summary: "Does a thing",
									description: "A test command.",
									options,
								},
							});
						}

						async run(): Promise<Result<void, Error>> {
							return ok(undefined);
						}
					}
				)
			);

			await help("repeatable");

			expect(printed()).toContain("Takes things. (repeatable)");
		});

		it("should accept every option that help prints for a command", async () => {
			for (const command of registry.getCommands().values()) {
				info.mockClear();
				await help(command.id);

				const options = [
					...GlobalOptions,
					...(command.metadata.options ?? []),
				];
				for (const option of options) {
					expect(printed()).toContain(`--${flagText(option)}`);

					const argv = [
						command.id,
						`--${option.name}`,
						...(option.type === "string"
							? [option.values?.[0] ?? "x"]
							: []),
					];
					expect(parseCommandLine(...argv).isOk()).toBe(true);
				}
			}
		});

		it("should print every option the parser accepts", async () => {
			const printedByAll = new Set<string>();
			for (const command of registry.getCommands().values()) {
				info.mockClear();
				await help(command.id);
				printedByAll.add(printed());
			}
			const everything = [...printedByAll].join("\n");

			for (const option of registry.getOptions()) {
				expect(everything).toContain(`--${flagText(option)}`);
			}
		});

		it("should bind each short flag to exactly one option", () => {
			const shorts = registry
				.getOptions()
				.flatMap((option) => (option.short ? [option.short] : []));

			expect(new Set(shorts).size).toBe(shorts.length);
		});
	});
});
