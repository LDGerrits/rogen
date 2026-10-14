import { jest } from "@jest/globals";
import { UsageError } from "../../../base/errors.js";
import { ResultError } from "../../../base/result.js";
import {
	CommandRegistry,
	Extensions,
} from "../../../platform/commands/commands.js";
import { DOCS_URL } from "../../../platform/product/product-service.js";
import { MockProductService } from "../../../platform/product/__tests__/mock-product-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { Registry } from "../../../platform/registry/registry.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import "../../build/build-command.js";
import "../../check/check-command.js";
import "../../fmt-project/fmt-project-command.js";
import "../doc-command.js";
import "../help-command.js";
import "../../init/init-command.js";
import "../../list/list-command.js";
import "../../serve/serve-command.js";
import "../../where/where-command.js";
import { helpTexts } from "../help-texts.js";

describe("rogen help --json", () => {
	const registry = Registry.as<CommandRegistry>(Extensions.Commands);
	let logService: NullLogService;
	let print: ReturnType<typeof jest.spyOn>;

	const help = (...positionals: string[]) =>
		commandHarness({
			log: logService,
			product: new MockProductService("2.3.4"),
		}).run("help", { positionals, options: { json: true } });

	const document = () => JSON.parse(String(print.mock.calls[0][0]));

	beforeEach(() => {
		logService = new NullLogService();
		print = jest.spyOn(logService, "print");
	});

	describe("without a name", () => {
		it("should list the commands, the global options, the exit codes and the error kinds", async () => {
			const result = await help();

			expect(result.isOk()).toBe(true);
			const { version, commands, globalOptions, exitCodes, errorKinds } =
				document();
			expect(version).toBe("2.3.4");
			expect(commands.map(({ name }: { name: string }) => name)).toEqual([
				...registry.getCommands().keys(),
			]);
			expect(
				globalOptions.map(({ name }: { name: string }) => name)
			).toEqual(["help", "version", "verbose", "quiet"]);
			expect(Object.keys(exitCodes)).toEqual(["0", "1", "2"]);
			expect(Object.keys(errorKinds)).toEqual([
				"usage",
				"project",
				"tool",
				"io",
				"cancelled",
				"internal",
			]);
		});

		it("should print one line", async () => {
			await help();

			expect(String(print.mock.calls[0][0])).not.toContain("\n");
		});

		it("should leave the prose of arguments and options to the command's own page", async () => {
			await help();

			const { commands } = document();
			const build = commands.find(
				({ name }: { name: string }) => name === "build"
			);
			expect(build.args).toEqual([
				{ name: "project", optional: true, variadic: true },
			]);
			expect(build.options).toContainEqual({
				name: "output",
				short: "o",
				type: "string",
			});
		});

		it("should say what each command does beyond printing", async () => {
			await help();

			const effects = Object.fromEntries(
				document().commands.map(
					({
						name,
						effects,
					}: {
						name: string;
						effects: string[];
					}) => [name, effects]
				)
			);
			expect(effects).toMatchObject({
				build: ["writesFiles", "runsProcesses", "longRunning"],
				serve: ["writesFiles", "runsProcesses", "longRunning"],
				init: ["writesFiles"],
				"fmt-project": ["writesFiles"],
				doc: ["opensBrowser"],
				check: [],
				list: [],
				where: [],
				help: [],
			});
		});

		it("should be small enough to read before every task", async () => {
			await help();

			expect(String(print.mock.calls[0][0]).length).toBeLessThan(4000);
		});
	});

	it("should declare what every command can do, even when it is nothing", () => {
		for (const command of registry.getCommands().values())
			expect([command.id, command.metadata.effects]).toEqual([
				command.id,
				expect.any(Array),
			]);
	});

	describe("with a command", () => {
		it("should add the descriptions, examples and the shape of what it prints", async () => {
			await help("build");

			const build = document();
			expect(build.name).toBe("build");
			expect(build.args[0].description).toContain(
				"A folder with a rogen.json"
			);
			expect(build.options).toContainEqual(
				expect.objectContaining({
					name: "output",
					description: expect.stringContaining("place or model file"),
				})
			);
			expect(build.examples).toContain("rogen build --json");
			expect(build.failure).toBe(
				"{diagnostics:[Diagnostic]}|{error:Error}"
			);
			expect(build.shapes.Error).toContain("kind:");
			expect(build.output.document).toBe(
				"{changed:bool,configs:[BuildEntry],rojo?:RojoEntry}"
			);
			expect(Object.keys(build.shapes)).toEqual(
				expect.arrayContaining([
					"BuildEntry",
					"RojoEntry",
					"Diagnostic",
				])
			);
		});

		it("should write a shape that several commands share the same way", async () => {
			await help("check");
			const check = document().shapes.Diagnostic;
			print.mockClear();
			await help("list");

			expect(document().shapes.Diagnostic).toBe(check);
		});

		it("should describe the output of help itself", async () => {
			await help("help");

			expect(document().output.document).toContain("code:string");
		});

		it("should resolve the name in any case", async () => {
			await help("Where");

			expect(document().name).toBe("where");
		});
	});

	describe("with a diagnostic code", () => {
		it("should print its text and where the docs explain it", async () => {
			await help("route.strayAt");

			expect(document()).toEqual({
				code: "route.strayAt",
				text: helpTexts.diagnostics["route.strayAt"],
				url: `${DOCS_URL}/diagnostics#route-strayat`,
			});
		});

		it("should resolve a code named without its module", async () => {
			await help("strayAt");

			expect(document().code).toBe("route.strayAt");
		});
	});

	describe("with a name that is neither", () => {
		it("should fail as a usage error that suggests the closest name", async () => {
			const result = await help("bulid");

			const { error } = result as ResultError<Error>;
			expect(error).toBeInstanceOf(UsageError);
			expect((error as UsageError).hint).toBe(
				"Did you mean 'rogen help build'?"
			);
			expect(print).not.toHaveBeenCalled();
		});
	});
});
