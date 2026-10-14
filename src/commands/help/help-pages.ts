import { ExitCodes, UsageError } from "../../base/errors.js";
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

const EXIT_CODES = `Exit codes: ${Object.entries(ExitCodes)
	.map(([code, meaning]) => `${code} ${meaning}`)
	.join(", ")}.`;

const ROOT_EXAMPLES = [
	"rogen build",
	"rogen serve",
	"rogen help build",
	"rogen help route.strayAt",
];

export type HelpTarget =
	| { readonly kind: "command"; readonly command: Command }
	| { readonly kind: "code"; readonly code: string };

const INDENT = "    ";
const GAP = "    ";

/** A name as a value or argument is written: `allowed-hosts` is `ALLOWED_HOSTS`. */
const capitalised = (name: string) =>
	name.toUpperCase().replace(/[\s-]+/g, "_");

const compareNames = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Argument = NonNullable<Command["metadata"]["args"]>[number];

function usageArgs(command: Command): string[] {
	return (command.metadata.args ?? []).map((arg) => {
		if (arg.subcommands) return "<SUBCOMMAND>";
		const name = capitalised(arg.name);
		const written = arg.isOptional ? `[${name}]` : `<${name}>`;
		return arg.isVariadic ? `${written}...` : written;
	});
}

function formatOption(option: OptionDescriptor): [string, string] {
	const name = option.negatable ? `[no-]${option.name}` : option.name;
	const flags = `${option.short ? `-${option.short}, ` : INDENT}--${name}`;
	const value =
		option.type === "string"
			? ` <${capitalised(option.placeholder ?? option.name)}>`
			: "";
	return [
		flags + value,
		[
			option.description,
			option.multiple ? "(repeatable)" : undefined,
			option.default === undefined
				? undefined
				: `[default: ${option.default}]`,
			option.values && `[possible values: ${option.values.join(", ")}]`,
		]
			.filter((part) => part !== undefined)
			.join(" "),
	];
}

function formatArgument(arg: Argument): [string, string] {
	return [
		`<${capitalised(arg.name)}>${arg.isVariadic ? "..." : ""}`,
		arg.description,
	];
}

function formatColumns(rows: [string, string][]): string[] {
	const width = Math.max(0, ...rows.map(([left]) => left.length));
	return rows.map(
		([left, right]) => `${INDENT}${left.padEnd(width)}${GAP}${right}`
	);
}

const sortedOptions = (options: readonly OptionDescriptor[]) =>
	[...options].sort((a, b) => compareNames(a.name, b.name));

function formatSections(
	header: string,
	description: string,
	sections: readonly (readonly [string, readonly string[]])[]
): string {
	return [
		header,
		description,
		...sections
			.filter(([, lines]) => lines.length > 0)
			.flatMap(([title, lines]) => ["", `${title}:`, ...lines]),
	].join("\n");
}

function formatHelp(
	commands: ReadonlyMap<string, Command>,
	globalOptions: readonly OptionDescriptor[]
): string {
	const subcommands = [...commands.values()]
		.sort((a, b) => compareNames(a.id, b.id))
		.map((command): [string, string] => [
			command.id,
			command.metadata.description,
		]);
	return [
		formatSections("rogen", "Feature-based architecture for Roblox", [
			["USAGE", [`${INDENT}rogen [OPTIONS] <SUBCOMMAND>`]],
			[
				"OPTIONS",
				formatColumns(sortedOptions(globalOptions).map(formatOption)),
			],
			["SUBCOMMANDS", formatColumns(subcommands)],
			["EXAMPLES", ROOT_EXAMPLES.map((line) => `${INDENT}${line}`)],
		]),
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
		"[OPTIONS]",
		...usageArgs(command),
		passthrough && `[-- <${capitalised(passthrough.name)}>...]`,
	]
		.filter(Boolean)
		.join(" ");
	const subcommands = args.flatMap((arg) => arg.subcommands ?? []);

	return formatSections(`rogen-${command.id}`, description, [
		["USAGE", [`${INDENT}${usage}`]],
		[
			"ARGS",
			formatColumns([
				...args.filter((arg) => !arg.subcommands).map(formatArgument),
				...(passthrough
					? [
							[
								`-- <${capitalised(passthrough.name)}>...`,
								passthrough.description,
							] as [string, string],
						]
					: []),
			]),
		],
		[
			"OPTIONS",
			formatColumns(
				sortedOptions([...globalOptions, ...options]).map(formatOption)
			),
		],
		[
			"SUBCOMMANDS",
			formatColumns(
				subcommands.map((sub) => [sub.name, sub.description])
			),
		],
		["EXAMPLES", examples.map((line) => `${INDENT}${line}`)],
	]);
}

export class HelpPages {
	constructor(private readonly commands: ReadonlyMap<string, Command>) {}

	overview(): string {
		return formatHelp(this.commands, GlobalOptions);
	}

	/** The command or diagnostic code `target` names. */
	resolve(target: string): HelpTarget | undefined {
		const code = codeNamed(target);
		const named =
			code === undefined ? undefined : { kind: "code" as const, code };
		if (isCode(target)) return named;
		const name = target.toLowerCase();
		const command = this.commands.get(name);
		if (command) return { kind: "command", command };
		return DocTopics.has(name) ? undefined : named;
	}

	textOf(target: HelpTarget): string {
		return target.kind === "command"
			? formatCommandHelp(target.command, GlobalOptions)
			: helpTexts.diagnostics[target.code];
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
