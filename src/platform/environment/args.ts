import { parseArgs as nodeParseArgs } from "util";
import { z } from "zod";
import { Result, err, ok } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";

export const ParsedArgsSchema = z.object({
	_: z.array(z.string()).default([]),
	help: z.boolean().optional(),
	version: z.boolean().optional(),
	init: z.boolean().optional(),
	watch: z.boolean().optional(),
	config: z.string().optional(),
	mode: z.array(z.string()).optional(),
	source: z.array(z.string()).optional(),
	env: z.array(z.string()).optional(),
	template: z.string().optional(),
	build: z.string().optional(),
	output: z.string().optional(),
	verbose: z.boolean().optional(),
	quiet: z.boolean().optional(),
	trace: z.boolean().optional(),
});

export type ParsedArgs = z.infer<typeof ParsedArgsSchema>;

export interface ParsedCli {
	command: string;
	options: ParsedArgs;
}

export function parseArgs(args: string[]): Result<ParsedCli, Error> {
	const options = {
		help: { type: "boolean" as const, short: "h" },
		version: { type: "boolean" as const, short: "v" },
		init: { type: "boolean" as const, short: "i" },
		watch: { type: "boolean" as const, short: "w" },
		config: { type: "string" as const, short: "c" },
		mode: { type: "string" as const, short: "m", multiple: true },
		source: { type: "string" as const, short: "s", multiple: true },
		env: { type: "string" as const, short: "e", multiple: true },
		template: { type: "string" as const, short: "t" },
		build: { type: "string" as const, short: "b" },
		output: { type: "string" as const, short: "o" },
		verbose: { type: "boolean" as const },
		quiet: { type: "boolean" as const, short: "q" },
		trace: { type: "boolean" as const },
	};

	try {
		const { values, positionals } = nodeParseArgs({
			args: args,
			options,
			allowPositionals: true,
			strict: true,
		});

		let command = "help";
		if (values.version) command = "version";
		else if (values.help) command = "help";
		else if (positionals.length > 0) command = positionals[0].toLowerCase();

		const parsedArgs = ParsedArgsSchema.parse({
			...values,
			_: positionals,
		});

		return ok({ command, options: parsedArgs });
	} catch (error) {
		const rawError = error as Record<string, unknown>;
		if (rawError.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
			const cleanMsg = (error as Error).message.replace(
				/^TypeError \[ERR_PARSE_ARGS_UNKNOWN_OPTION\]:\s*/,
				""
			);
			return err(
				new ParseArgumentError(
					`${cleanMsg}\nRun 'rogen --help' to see available commands.`,
					rawError.code as string
				)
			);
		}
		return err(ErrorUtils.fromUnknown(error));
	}
}

class ParseArgumentError extends Error {
	constructor(
		message: string,
		public readonly code: string
	) {
		super(message);
		this.name = "ParseArgumentError";
	}
}
