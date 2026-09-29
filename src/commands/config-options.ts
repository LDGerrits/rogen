import { Result, err, ok } from "../base/result.js";
import { OptionDescriptor, ParsedArgs } from "../platform/environment/args.js";
import { ConfigRefs } from "../domain/config/config-service.js";

/** The flags that override, or pick, the configs a command reads. */
export const ConfigOptions: readonly OptionDescriptor[] = [
	{
		name: "config",
		short: "c",
		type: "string",
		multiple: true,
		description: "An explicit config path.",
	},
	{
		name: "out-file",
		short: "o",
		type: "string",
		description: "Overrides outFile.",
	},
	{
		name: "sync-dir",
		short: "s",
		type: "string",
		description: "Overrides syncDir.",
	},
	{
		name: "template",
		type: "string",
		description: "Overrides template.",
	},
	{
		name: "tag",
		short: "t",
		type: "string",
		multiple: true,
		description: "Turns a tag on.",
	},
	{
		name: "no-tag",
		short: "T",
		type: "string",
		multiple: true,
		description: "Turns a tag off.",
	},
];

/** Overrides that name one value, which several configs can't share. */
const SINGLE_CONFIG_OPTIONS = ["out-file", "sync-dir", "template"] as const;

export class ConfigRefsError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
		this.name = "ConfigRefsError";
	}
}

/** The flag as a user types it, taken from the table so the two can't drift. */
function flagOf(name: string): string {
	const short = ConfigOptions.find((option) => option.name === name)?.short;
	return short ? `-${short}` : `--${name}`;
}

/** The configs a command names, and the overrides that sit above every layer of each. */
export function configRefsFromArgs(
	args: ParsedArgs
): Result<ConfigRefs, ConfigRefsError> {
	const names = args._.slice(1);
	const paths = args.config ?? [];

	if (names.length + paths.length > 1) {
		const option = SINGLE_CONFIG_OPTIONS.find(
			(name) => args[name] !== undefined
		);
		if (option) {
			return err(
				new ConfigRefsError(
					"cli.singleConfigFlag",
					`${flagOf(option)} targets a single config, but several were named. Name one config, or set it in the file.`
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
