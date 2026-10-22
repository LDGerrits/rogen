import { ExitCodes, UsageError } from "../../base/errors.js";
import { closestMatch } from "../../base/strings.js";
import { Command } from "../../platform/commands/commands.js";
import {
	GlobalOptions,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { HelpDocument } from "./help-document.js";
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
	.join(", ")}. 'check' also exits 1 on a warning.`;

const ROOT_EXAMPLES = [
	"rogen build",
	"rogen serve",
	"rogen help build",
	"rogen help route.strayAt",
];

export type HelpTarget =
	| { readonly kind: "command"; readonly command: Command }
	| { readonly kind: "code"; readonly code: string }
	| { readonly kind: "codes"; readonly prefix?: string }
	| { readonly kind: "topic"; readonly name: string };

/** The name of the page that lists every diagnostic code. */
const CODES_PAGE = "codes";

const SHORT_HELP_NOTE = "Run with --help for details.";

const INDENT = "    ";
const GAP = "    ";
/** The width help is wrapped to, as Rojo's is. */
const WIDTH = 100;

/** `text` broken at spaces into lines of at most `width`, a longer word on a line of its own; a line break in `text` stays, and a bullet's later lines are indented under its text. */
function wrapped(text: string, width: number): string[] {
	if (text.includes("\n"))
		return text.split("\n").flatMap((line) => wrapped(line, width));
	if (text.startsWith("- "))
		return wrapped(text.slice(2), width - 2).map((line, index) =>
			index === 0 ? `- ${line}` : `  ${line}`
		);
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		if (line && line.length + 1 + word.length > width) {
			lines.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	return [...lines, line];
}

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

/** `text` up to its first full stop followed by a space, or all of it. */
export function firstSentence(text: string): string {
	const end = text.indexOf(". ");
	return end === -1 ? text : text.slice(0, end + 1);
}

/** How much of each description help prints. */
export type HelpForm = "short" | "long";

const describedAs = (text: string, form: HelpForm) =>
	form === "short" ? firstSentence(text) : text;

function formatOption(
	option: OptionDescriptor,
	form: HelpForm
): [string, string] {
	const name = option.negatable ? `[no-]${option.name}` : option.name;
	const flags = `${option.short ? `-${option.short}, ` : INDENT}--${name}`;
	const value =
		option.type === "string"
			? ` <${capitalised(option.placeholder ?? option.name)}>`
			: "";
	return [
		flags + value,
		[
			describedAs(option.description, form),
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

function formatArgument(arg: Argument, form: HelpForm): [string, string] {
	return [
		`<${capitalised(arg.name)}>${arg.isVariadic ? "..." : ""}`,
		describedAs(arg.description, form),
	];
}

function formatColumns(rows: [string, string][]): string[] {
	const width = Math.max(0, ...rows.map(([left]) => left.length));
	const column = INDENT.length + width + GAP.length;
	return rows.flatMap(([left, right]) =>
		wrapped(right, WIDTH - column).map((line, index) =>
			index === 0
				? `${INDENT}${left.padEnd(width)}${GAP}${line}`
				: `${" ".repeat(column)}${line}`
		)
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
		...wrapped(description, WIDTH),
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
			command.metadata.summary,
		]);
	return [
		formatSections("rogen", "Feature-based architecture for Roblox", [
			["USAGE", [`${INDENT}rogen [OPTIONS] <SUBCOMMAND>`]],
			[
				"OPTIONS",
				formatColumns(
					sortedOptions(globalOptions).map((option) =>
						formatOption(option, "long")
					)
				),
			],
			["SUBCOMMANDS", formatColumns(subcommands)],
			["EXAMPLES", ROOT_EXAMPLES.map((line) => `${INDENT}${line}`)],
		]),
		"",
		...wrapped(
			"Run 'rogen help <command>' for details on a command, 'rogen doc <topic>' to read a topic, and 'rogen help <code>' to explain a diagnostic code.",
			WIDTH
		),
		"",
		...wrapped(EXIT_CODES, WIDTH),
	].join("\n");
}

function formatCommandHelp(
	command: Command,
	globalOptions: readonly OptionDescriptor[],
	form: HelpForm
): string {
	const {
		description,
		args = [],
		options = [],
		examples = [],
	} = command.metadata;
	const usage = ["rogen", command.id, "[OPTIONS]", ...usageArgs(command)]
		.filter(Boolean)
		.join(" ");
	const subcommands = args.flatMap((arg) => arg.subcommands ?? []);

	const text = formatSections(`rogen-${command.id}`, description, [
		["USAGE", [`${INDENT}${usage}`]],
		[
			"ARGS",
			formatColumns(
				args
					.filter((arg) => !arg.subcommands)
					.map((arg) => formatArgument(arg, form))
			),
		],
		[
			"OPTIONS",
			formatColumns(
				sortedOptions([...globalOptions, ...options]).map((option) =>
					formatOption(option, form)
				)
			),
		],
		[
			"SUBCOMMANDS",
			formatColumns(
				subcommands.map((sub) => [
					sub.name,
					describedAs(sub.description, form),
				])
			),
		],
		[
			"EXIT CODES",
			formatColumns(Object.entries(command.metadata.exitCodes ?? {})),
		],
		["EXAMPLES", examples.map((line) => `${INDENT}${line}`)],
	]);
	return form === "short" ? `${text}\n\n${SHORT_HELP_NOTE}` : text;
}

export class HelpPages {
	constructor(private readonly commands: ReadonlyMap<string, Command>) {}

	overview(): string {
		return formatHelp(this.commands, GlobalOptions);
	}

	/** The command or diagnostic code `target` names. */
	resolve(target: string, prefix?: string): HelpTarget | undefined {
		if (target.toLowerCase() === CODES_PAGE)
			return { kind: "codes", ...(prefix && { prefix }) };
		const code = codeNamed(target);
		const named =
			code === undefined ? undefined : { kind: "code" as const, code };
		if (isCode(target)) return named;
		const name = target.toLowerCase();
		const command = this.commands.get(name);
		if (command) return { kind: "command", command };
		return DocTopics.has(name) ? { kind: "topic", name } : named;
	}

	textOf(target: HelpTarget, form: HelpForm = "long"): string {
		if (target.kind === "command")
			return formatCommandHelp(target.command, GlobalOptions, form);
		if (target.kind === "topic") return DocTopics.textOf(target.name) ?? "";
		if (target.kind === "codes") {
			const { codes } = HelpDocument.codes(target.prefix);
			const codeWidth = Math.max(...codes.map(({ code }) => code.length));
			const indent = " ".repeat(codeWidth + 2);
			return codes
				.map(({ code, severity, summary }) =>
					wrapped(
						`${severity === "error" ? "error  " : "warning"} ${summary}`,
						WIDTH - codeWidth - 2
					)
						.map((line, index) =>
							index === 0
								? `${code.padEnd(codeWidth)}  ${line}`
								: `${indent}${line}`
						)
						.join("\n")
				)
				.join("\n");
		}
		return helpTexts.diagnostics[target.code]
			.split("\n")
			.flatMap((line) =>
				line.startsWith(" ") ? [line] : wrapped(line, WIDTH)
			)
			.join("\n");
	}

	unknown(target: string): UsageError {
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
