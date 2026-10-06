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
import { Registry } from "../../platform/registry/registry.js";

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
	].join("\n");
}

function formatCommandHelp(
	command: Command,
	globalOptions: readonly OptionDescriptor[]
): string {
	const { description, args = [], options = [] } = command.metadata;
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
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<readonly []>
		): Promise<Result<void, Error>> {
			const registry = Registry.as<CommandRegistry>(Extensions.Commands);
			const logService = accessor.get(LogService);

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
					new Error(
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
