import { jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MockProductService } from "../../../platform/product/__tests__/mock-product-service.js";
import {
	CommandHarness,
	commandHarness,
} from "../../__tests__/command-harness.js";
import "../../build/build-command.js";
import "../../check/check-command.js";
import "../../fmt-project/fmt-project-command.js";
import "../doc-command.js";
import "../help-command.js";
import "../../init/init-command.js";
import "../../list/list-command.js";
import "../../serve/serve-command.js";
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
	parseArgs,
} from "../../../platform/environment/args.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { Registry } from "../../../platform/registry/registry.js";
import { helpTexts } from "../help-texts.js";

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
		it("should list every registered command with its description", async () => {
			const result = await help();

			expect(result.isOk()).toBe(true);
			for (const command of registry.getCommands().values()) {
				expect(printed()).toContain(command.id);
				expect(printed()).toContain(command.metadata.description);
			}
		});

		it("should list every global option", async () => {
			await help();

			for (const option of GlobalOptions) {
				expect(printed()).toContain(`--${option.name}`);
			}
		});

		it("should end with the exit codes", async () => {
			await help();

			expect(printed().split("\n").at(-1)).toBe(
				"Exit codes: 0 done (warnings included), 1 the project has errors, 2 the command line is wrong."
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

	describe("rogen help <command>", () => {
		it("should print the command's usage and arguments", async () => {
			await help("build");

			expect(printed()).toContain("rogen build [project...] [options]");
			expect(printed()).toContain("A folder with a rogen.json");
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
					`Examples:\n  ${command.metadata.examples?.[0]}`
				);
				expect(text.indexOf("Examples:")).toBeGreaterThan(
					text.indexOf("Arguments:")
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

			expect(printed()).toContain("-t, --thing <path>");
		});

		it("should write <value> for a string option without a placeholder", async () => {
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

			expect(printed()).toContain("--thing <value>");
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
					expect(printed()).toContain(`--${option.name}`);

					const argv = [
						command.id,
						`--${option.name}`,
						...(option.type === "string" ? ["x"] : []),
					];
					expect(
						parseArgs(argv, (id) => registry.getOptions(id), [
							...registry.getCommands().keys(),
						]).isOk()
					).toBe(true);
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
				expect(everything).toContain(`--${option.name}`);
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
