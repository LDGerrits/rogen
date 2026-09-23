import { Command } from "../../platform/commands/commands.js";
import { OptionDescriptor } from "../../platform/environment/args.js";

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

export function formatHelp(
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
		"  rogen <command> [options]",
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

export function formatCommandHelp(
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
