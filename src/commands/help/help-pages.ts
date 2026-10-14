import { UsageError } from "../../base/errors.js";
import { closestMatch } from "../../base/strings.js";
import { Command } from "../../platform/commands/commands.js";
import {
	GlobalOptions,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { DocTopics } from "./doc-topics.js";
import { helpTexts } from "./help-texts.js";

/** A diagnostic code has a dot, which no command or topic does. */
const isCode = (name: string) => name.includes(".");

/** A name without its module stands for the one code that ends in it. */
function codeNamed(name: string): string | undefined {
	const codes = Object.keys(helpTexts.diagnostics);
	const lower = name.toLowerCase();
	if (isCode(name)) return codes.find((code) => code.toLowerCase() === lower);
	const ending = codes.filter(
		(code) => code.slice(code.indexOf(".") + 1).toLowerCase() === lower
	);
	return ending.length === 1 ? ending[0] : undefined;
}

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
		"Run 'rogen help <command>' for details on a command, 'rogen doc <topic>' to read a topic, and 'rogen help <code>' to explain a diagnostic code.",
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
		passthrough,
		options = [],
		examples = [],
	} = command.metadata;
	const usage = [
		"rogen",
		command.id,
		usageArgs(command),
		"[options]",
		passthrough && `[-- ${passthrough.name}...]`,
	]
		.filter(Boolean)
		.join(" ");

	const sections = [description, "", "Usage:", `  ${usage}`];

	const argRows = [
		...args.map((arg): [string, string] => [arg.name, arg.description]),
		...(passthrough
			? [
					[`-- ${passthrough.name}`, passthrough.description] as [
						string,
						string,
					],
				]
			: []),
	];
	if (argRows.length > 0) {
		sections.push("", "Arguments:", ...formatColumns(argRows));
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

export class HelpPages {
	constructor(private readonly commands: ReadonlyMap<string, Command>) {}

	overview(): string {
		return formatHelp(this.commands, GlobalOptions);
	}

	find(target: string): string | undefined {
		const code = codeNamed(target);
		if (isCode(target)) return code && helpTexts.diagnostics[code];
		const name = target.toLowerCase();
		const command = this.commands.get(name);
		if (command) return formatCommandHelp(command, GlobalOptions);
		if (DocTopics.has(name)) return undefined;
		return code && helpTexts.diagnostics[code];
	}

	unknown(target: string): UsageError {
		if (DocTopics.has(target))
			return new UsageError(
				`"${target}" is a topic, not a command.`,
				`Run 'rogen doc ${target.toLowerCase()}'.`
			);
		const codes = Object.keys(helpTexts.diagnostics);
		const named = new Map<string, string>();
		const add = (name: string, standsFor: string) => {
			if (!named.has(name)) named.set(name, standsFor);
		};
		if (isCode(target)) codes.forEach((code) => add(code, code));
		else {
			[...this.commands.keys()].forEach((name) => add(name, name));
			codes.forEach((code) =>
				add(code.slice(code.indexOf(".") + 1), code)
			);
		}
		const what = isCode(target) ? "diagnostic code" : "command";
		const closest = closestMatch(target, named.keys());
		const suggestion = closest && named.get(closest);
		return new UsageError(
			`Unknown ${what} "${target}".`,
			suggestion
				? `Did you mean 'rogen help ${suggestion}'?`
				: "Run 'rogen help' to see the commands."
		);
	}
}
