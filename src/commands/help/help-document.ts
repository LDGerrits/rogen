import { ErrorKinds, ExitCodes } from "../../base/errors.js";
import { Command } from "../../platform/commands/commands.js";
import {
	GlobalOptions,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import {
	diagnosticUrl,
	failureShape,
} from "../../platform/diagnostics/diagnostic-json.js";
import { OutputNotation } from "../../platform/output/output-notation.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { helpTexts } from "./help-texts.js";

const S = OutputShape;

const EFFECTS = [
	"writesFiles",
	"runsProcesses",
	"opensBrowser",
	"longRunning",
] as const;

const optionFields = {
	name: S.string,
	short: S.optional(S.string),
	type: S.enum("string", "boolean"),
	multiple: S.optional(S.boolean),
	negatable: S.optional(S.boolean),
	enum: S.optional(S.array(S.string)),
	default: S.optional(S.string),
};

const argFields = {
	name: S.string,
	optional: S.optional(S.boolean),
	variadic: S.optional(S.boolean),
	enum: S.optional(S.array(S.string)),
};

const optionShape = S.named("Option", S.object(optionFields));

const argShape = S.named("Arg", S.object(argFields));

const commandShape = S.named(
	"Command",
	S.object({
		name: S.string,
		summary: S.string,
		args: S.array(argShape),
		options: S.array(optionShape),
		effects: S.array(S.enum(...EFFECTS)),
	})
);

const codeBriefShape = S.named(
	"CodeBrief",
	S.object({
		code: S.string,
		severity: S.enum("error", "warning"),
		summary: S.string,
		url: S.string,
	})
);

const overviewShape = S.object({
	version: S.string,
	commands: S.array(commandShape),
	globalOptions: S.array(optionShape),
	exitCodes: S.record(S.string),
	errorKinds: S.record(S.object({ exitCode: S.integer, meaning: S.string })),
});

const detailShape = S.object({
	name: S.string,
	summary: S.string,
	description: S.string,
	args: S.array(S.object({ ...argFields, description: S.string })),
	options: S.array(S.object({ ...optionFields, description: S.string })),
	passthrough: S.optional(
		S.object({ name: S.string, description: S.string })
	),
	effects: S.array(S.enum(...EFFECTS)),
	examples: S.array(S.string),
	exitCodes: S.record(S.string),
	output: S.optional(
		S.object({
			document: S.optional(S.string),
			lines: S.optional(S.string),
		})
	),
	failure: S.optional(S.string),
	shapes: S.optional(S.record(S.string)),
});

const codeShape = S.object({
	code: S.string,
	text: S.string,
	url: S.string,
});

const codesShape = S.object({ codes: S.array(codeBriefShape) });

/** The document of `help --json`: the commands, one command in full, one diagnostic code, or the list of codes. */
export const helpDocumentShape = S.union(
	overviewShape,
	detailShape,
	codeShape,
	codesShape
);

const optionBrief = ({
	name,
	short,
	type,
	multiple,
	negatable,
	values,
	default: fallback,
}: OptionDescriptor) => ({
	name,
	...(short && { short }),
	type,
	...(multiple && { multiple }),
	...(negatable && { negatable }),
	...(values && { enum: values }),
	...(fallback !== undefined && { default: fallback }),
});

const argBrief = ({
	name,
	isOptional,
	isVariadic,
	subcommands,
}: NonNullable<Command["metadata"]["args"]>[number]) => ({
	name,
	...(isOptional && { optional: true }),
	...(isVariadic && { variadic: true }),
	...(subcommands && { enum: subcommands.map(({ name }) => name) }),
});

const SECTION_OPENING =
	/^(Error|Warning)(?:, or error)?[.,]\s+(.*?[.!?])(?:\s|$)/s;

/** A diagnostic code with its severity and the first sentence of what it means, read from its help text. */
export function codeBrief(code: string) {
	const [, paragraph = ""] = helpTexts.diagnostics[code].split("\n\n");
	const [, severity, summary] = SECTION_OPENING.exec(paragraph) ?? [];
	return {
		code,
		severity:
			severity === "Error" ? ("error" as const) : ("warning" as const),
		summary: (summary ?? paragraph).replace(/\s+/g, " "),
		url: diagnosticUrl(code),
	};
}

const effectsOf = ({ metadata }: Command) => [
	...(metadata.effects ?? []),
	...(metadata.longRunning || metadata.longRunningWith !== undefined
		? (["longRunning"] as const)
		: []),
];

export const HelpDocument = {
	/** Every command and what it takes, without the prose of its arguments and options. */
	overview(commands: ReadonlyMap<string, Command>, version: string) {
		return {
			version,
			commands: [...commands.values()].map((command) => ({
				name: command.id,
				summary: command.metadata.summary,
				args: (command.metadata.args ?? []).map(argBrief),
				options: (command.metadata.options ?? []).map(optionBrief),
				effects: effectsOf(command),
			})),
			globalOptions: GlobalOptions.map(optionBrief),
			exitCodes: {
				...ExitCodes,
				0: "done (warnings included; check exits 1 on any)",
			},
			errorKinds: ErrorKinds,
		};
	},

	/** One command in full: its arguments and options with their prose, examples and the shape of what it prints. */
	command(command: Command) {
		const {
			options = [],
			examples = [],
			output,
			passthrough,
		} = command.metadata;
		const shapes = output
			? OutputNotation.shapesOf(output, failureShape)
			: {};
		return {
			name: command.id,
			summary: command.metadata.summary,
			description: command.metadata.description,
			args: (command.metadata.args ?? []).map((arg) => ({
				...argBrief(arg),
				description: arg.description,
			})),
			options: options.map((option) => ({
				...optionBrief(option),
				description: option.description,
			})),
			...(passthrough && { passthrough }),
			effects: effectsOf(command),
			examples,
			exitCodes: { ...ExitCodes, ...command.metadata.exitCodes },
			...(output && {
				output: OutputNotation.describe(output),
				failure: OutputNotation.of(failureShape),
			}),
			...(Object.keys(shapes).length > 0 && { shapes }),
		};
	},

	/** Every diagnostic code, or those that start with `prefix`, with the severity and the first sentence of what it means. */
	codes(prefix = "") {
		const start = prefix.toLowerCase();
		return {
			codes: Object.keys(helpTexts.diagnostics)
				.filter((code) => code.toLowerCase().startsWith(start))
				.map(codeBrief),
		};
	},

	/** What a diagnostic code means, and where the docs explain it. */
	code(code: string) {
		return {
			code,
			text: helpTexts.diagnostics[code],
			url: diagnosticUrl(code),
		};
	},
} as const;
