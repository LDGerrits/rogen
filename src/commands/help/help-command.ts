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
	HELP_COMMAND,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { ProductService } from "../../platform/product/product-service.js";
import { Registry } from "../../platform/registry/registry.js";
import { helpTexts } from "./help-texts.js";

/** A section of the reference, by name; its text ships in the binary. */
interface HelpTopic {
	readonly name: string;
	readonly description: string;
}

const TOPICS: readonly HelpTopic[] = [
	{
		name: "routing",
		description:
			"How folders and names place a file, and what that means for requires.",
	},
	{
		name: "variants",
		description: "Files that swap in when a variant is on.",
	},
	{
		name: "config",
		description: "Config fields, extends, places, templates and sync dirs.",
	},
	{
		name: "layout",
		description: "Invisible folders, init scripts and .meta.json files.",
	},
	{
		name: "output",
		description: "Diagnostics, exit codes, --json, fixes and docs links.",
	},
];

/** A diagnostic code has a dot, which no command or topic does. */
const isCode = (name: string) => name.includes(".");

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
	const value =
		option.type === "string" ? ` <${option.placeholder ?? "value"}>` : "";
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
	const topics = TOPICS.map(({ name, description }): [string, string] => [
		name,
		description,
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
		"Topics:",
		...formatColumns(topics),
		"",
		"Options:",
		...formatColumns(globalOptions.map(formatOption)),
		"",
		"Run 'rogen help <command>' for details on a command, 'rogen help <topic>' to read a topic, and 'rogen help <code>' to explain a diagnostic code.",
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
				id: HELP_COMMAND,
				metadata: {
					description:
						"Prints usage, a command's details, a topic, or what a diagnostic code means.",
					args: [
						{
							name: "name",
							description:
								"A command, a topic, or a diagnostic code such as route.strayAt.",
							isOptional: true,
						},
					],
					examples: [
						"rogen help where",
						"rogen help routing",
						"rogen help route.strayAt",
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

			const text = this.textOf(target, registry);
			if (text === undefined) return err(this.unknown(target, registry));
			logService.print(text);
			return ok(undefined);
		}

		private textOf(
			target: string,
			registry: CommandRegistry
		): string | undefined {
			if (isCode(target)) return helpTexts.diagnostics[target];
			const name = target.toLowerCase();
			const command = registry.getCommand(name);
			if (command) return formatCommandHelp(command, GlobalOptions);
			return TOPICS.some((topic) => topic.name === name)
				? helpTexts.topics[name]
				: undefined;
		}

		private unknown(target: string, registry: CommandRegistry): Error {
			const codes = Object.keys(helpTexts.diagnostics);
			// A command or topic wins over the end of a code.
			const named = new Map<string, string>();
			const add = (name: string, standsFor: string) => {
				if (!named.has(name)) named.set(name, standsFor);
			};
			if (isCode(target)) codes.forEach((code) => add(code, code));
			else {
				const names = [
					...registry.getCommands().keys(),
					...TOPICS.map(({ name }) => name),
				];
				names.forEach((name) => add(name, name));
				codes.forEach((code) =>
					add(code.slice(code.indexOf(".") + 1), code)
				);
			}
			const what = isCode(target)
				? "diagnostic code"
				: "command or topic";
			const closest = closestMatch(target, named.keys());
			const suggestion = closest && named.get(closest);
			return new UsageError(
				suggestion
					? `Unknown ${what} "${target}". Did you mean 'rogen help ${suggestion}'?`
					: `Unknown ${what} "${target}". Run 'rogen help' to see the commands and topics.`
			);
		}
	}
);
