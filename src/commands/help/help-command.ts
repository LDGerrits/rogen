import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import {
	AbstractCommand,
	Command,
	CommandRegistry,
	Extensions,
	registerCommand,
} from "../../platform/commands/commands.js";
import {
	CommandLine,
	GlobalOptions,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { ProductService } from "../../platform/product/product-service.js";
import { Registry } from "../../platform/registry/registry.js";

const EXIT_CODES =
	"Exit codes: 0 done (warnings included), 1 the project has errors, 2 the command line is wrong.";

function usageArgs(command: Command): string {
	return (command.metadata.args ?? [])
		.map((arg) => {
			const name = arg.isVariadic ? `${arg.name}...` : arg.name;
			return arg.isOptional ? `[${name}]` : `<${name}>`;
		})
		.join(" ");
}

function formatOption(option: OptionDescriptor): [string, string] {
	const flags = option.short
		? `-${option.short}, --${option.name}`
		: `    --${option.name}`;
	const value = option.type === "string" ? " <value>" : "";
	const repeatable = option.multiple ? " (repeatable)" : "";
	return [flags + value, option.description + repeatable];
}

function formatColumns(rows: [string, string][]): string[] {
	const width = Math.max(0, ...rows.map(([left]) => left.length));
	return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`);
}

function formatHelp(
	commands: ReadonlyMap<string, Command>,
	globalOptions: readonly OptionDescriptor[]
): string {
	const rows = [...commands.values()].map((command): [string, string] => [
		[command.id, usageArgs(command)].filter(Boolean).join(" "),
		command.metadata.description,
	]);

	return [
		"Rogen - Feature-based architecture for Roblox",
		"",
		"Usage:",
		"  rogen [command] [name...] [options]",
		"",
		"Commands:",
		...formatColumns(rows),
		"",
		"Options:",
		...formatColumns(globalOptions.map(formatOption)),
		"",
		"Run 'rogen help <command>' for details on a command.",
		"",
		EXIT_CODES,
	].join("\n");
}

function formatCommandHelp(
	command: Command,
	globalOptions: readonly OptionDescriptor[]
): string {
	const {
		description,
		args = [],
		options = [],
		examples = [],
	} = command.metadata;
	const usage = ["rogen", command.id, usageArgs(command), "[options]"]
		.filter(Boolean)
		.join(" ");

	const sections = [description, "", "Usage:", `  ${usage}`];

	if (args.length > 0) {
		sections.push(
			"",
			"Arguments:",
			...formatColumns(
				args.map((arg): [string, string] => [arg.name, arg.description])
			)
		);
	}

	if (options.length > 0) {
		sections.push(
			"",
			"Options:",
			...formatColumns(options.map(formatOption))
		);
	}

	if (examples.length > 0) {
		sections.push("", "Examples:", ...examples.map((line) => `  ${line}`));
	}

	sections.push(
		"",
		"Global options:",
		...formatColumns(globalOptions.map(formatOption))
	);

	return sections.join("\n");
}

registerCommand(
	class HelpCommand extends AbstractCommand {
		constructor() {
			super({
				id: "help",
				metadata: {
					description: "Prints usage, or details for one command.",
					args: [
						{
							name: "command",
							description: "The command to describe.",
							isOptional: true,
						},
					],
					examples: ["rogen help", "rogen help where"],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<readonly []>
		): Promise<Result<void, Error>> {
			const registry = Registry.as<CommandRegistry>(Extensions.Commands);
			const logService = accessor.get(LogService);

			if (line.options.version) {
				const version = await accessor.get(ProductService).getVersion();
				logService.print(`rogen ${version}`);
				return ok(undefined);
			}

			// `rogen build --help` and `rogen help build` both name the command.
			const [target] = line.positionals;

			if (target === undefined) {
				logService.print(
					formatHelp(registry.getCommands(), GlobalOptions)
				);
				return ok(undefined);
			}

			const command = registry.getCommand(target.toLowerCase());
			if (!command) {
				const suggestion = closestMatch(
					target,
					registry.getCommands().keys()
				);
				return err(
					new UsageError(
						suggestion
							? `Unknown command "${target}". Did you mean 'rogen help ${suggestion}'?`
							: `Unknown command "${target}". Run 'rogen help' to see available commands.`
					)
				);
			}

			logService.print(formatCommandHelp(command, GlobalOptions));
			return ok(undefined);
		}
	}
);
