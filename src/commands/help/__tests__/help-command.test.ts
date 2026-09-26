import { jest } from "@jest/globals";
import "../../build/build-command.js";
import "../help-command.js";
import "../../init/init-command.js";
import "../../version/version-command.js";
import "../../watch/watch-command.js";
import { DisposableStore } from "../../../base/disposable.js";
import { ResultError } from "../../../base/result.js";
import {
	CommandRegistry,
	Extensions,
	GlobalOptions,
} from "../../../platform/commands/commands.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { parseArgs } from "../../../platform/environment/args.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import {
	LogService,
	NullLogService,
} from "../../../platform/log/log-service.js";
import { Registry } from "../../../platform/registry/registry.js";

describe("help command", () => {
	const registry = Registry.as<CommandRegistry>(Extensions.Commands);
	let store: DisposableStore;
	let logService: NullLogService;
	let info: ReturnType<typeof jest.spyOn>;
	let commandService: CoreCommandService;

	const help = (...positionals: string[]) =>
		commandService.executeCommand("help", { _: ["help", ...positionals] });

	const printed = () => String(info.mock.calls[0][0]);

	beforeEach(() => {
		store = new DisposableStore();
		logService = new NullLogService();
		info = jest.spyOn(logService, "print");
		const services = new ServiceCollection();
		services.set(LogService, logService);
		commandService = store.add(
			new CoreCommandService(services, logService)
		);
	});

	afterEach(() => {
		store[Symbol.dispose]();
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
	});

	describe("rogen help <command>", () => {
		it("should print the command's usage and arguments", async () => {
			await help("build");

			expect(printed()).toContain("rogen build [name...] [options]");
			expect(printed()).toContain("A config to build.");
		});

		it("should resolve the command from --help as well", async () => {
			await commandService.executeCommand("help", {
				_: ["build"],
				help: true,
			});

			expect(printed()).toContain("rogen build");
		});

		it("should return an error naming an unknown command", async () => {
			const result = await help("prod");

			expect((result as ResultError<Error>).error.message).toContain(
				'Unknown command "prod"'
			);
		});
	});

	describe("option table", () => {
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
						parseArgs(argv, (id) => registry.getOptions(id)).isOk()
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
