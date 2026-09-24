import { Result, err, ok } from "../../base/result.js";
import { ParsedArgs } from "../../platform/environment/args.js";
import { ConfigRefs } from "./config-service.js";

export class ConfigRefsError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
		this.name = "ConfigRefsError";
	}
}

const SINGLE_CONFIG_FLAGS = [
	["out-file", "-o"],
	["sync-dir", "-s"],
	["template", "--template"],
] as const;

export function configRefsFromArgs(
	args: ParsedArgs
): Result<ConfigRefs, ConfigRefsError> {
	const names = args._.slice(1);
	const paths = args.config ?? [];

	if (names.length + paths.length > 1) {
		const flag = SINGLE_CONFIG_FLAGS.find(
			([key]) => args[key] !== undefined
		);
		if (flag) {
			return err(
				new ConfigRefsError(
					"cli.singleConfigFlag",
					`${flag[1]} targets a single config, but several were named. Name one config, or set it in the file.`
				)
			);
		}
	}

	return ok({
		names,
		paths,
		overrides: {
			outFile: args["out-file"],
			syncDir: args["sync-dir"],
			template: args.template,
			tags: {
				...Object.fromEntries(
					(args.tag ?? []).map((tag) => [tag, true])
				),
				...Object.fromEntries(
					(args["no-tag"] ?? []).map((tag) => [tag, false])
				),
			},
		},
	});
}
