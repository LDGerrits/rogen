import { Result, err, ok } from "../../base/result.js";
import {
	ConfigRefs,
	ConfigService,
} from "../../domain/config/config-service.js";
import { AbstractCommand } from "../../platform/commands/commands.js";
import {
	OptionDescriptor,
	ParsedArgs,
} from "../../platform/environment/args.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";

const AllOption: OptionDescriptor = {
	name: "all",
	type: "boolean",
	description: "Every config in the working directory.",
};

const ConfigPathOption: OptionDescriptor = {
	name: "config",
	short: "c",
	type: "string",
	multiple: true,
	description: "An explicit config path.",
};

const TagOption: OptionDescriptor = {
	name: "tag",
	short: "t",
	type: "string",
	multiple: true,
	description: "Turns a tag on.",
};

const NoTagOption: OptionDescriptor = {
	name: "no-tag",
	short: "T",
	type: "string",
	multiple: true,
	description: "Turns a tag off.",
};

/** The flags that pick the configs a command reads and which tags are on in them. */
export const ConfigSelectionOptions: readonly OptionDescriptor[] = [
	AllOption,
	ConfigPathOption,
	TagOption,
	NoTagOption,
];

/** The flags that pick, or override, the configs a command builds. */
export const ConfigOptions: readonly OptionDescriptor[] = [
	AllOption,
	ConfigPathOption,
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
	TagOption,
	NoTagOption,
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

/** The configs `names` and the flags pick, and the overrides above every layer of each. */
function configRefsOf(
	args: ParsedArgs,
	names: readonly string[]
): Result<ConfigRefs, ConfigRefsError> {
	const paths = args.config ?? [];
	const all = args.all === true;

	if (all && names.length + paths.length > 0) {
		return err(
			new ConfigRefsError(
				"cli.allWithNames",
				"--all already builds every config here, so it takes no names or -c paths. Drop one or the other."
			)
		);
	}

	if (all || names.length + paths.length > 1) {
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
		all,
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

/** A command that works on the configs its arguments pick: it loads them, then runs with them loaded. */
export abstract class AbstractConfigCommand extends AbstractCommand {
	async run(
		accessor: ServicesAccessor,
		args: ParsedArgs
	): Promise<Result<void, Error>> {
		const refs = configRefsOf(args, this.configNames(args));
		if (refs.isErr()) return refs;
		const loaded = await accessor.get(ConfigService).initialize(refs.value);
		if (loaded.isErr()) return loaded;
		return this.runWithConfigs(accessor, args);
	}

	/** The configs named on the command line: the positionals after the command, unless they name something else. */
	protected configNames(args: ParsedArgs): readonly string[] {
		return args._.slice(1);
	}

	protected abstract runWithConfigs(
		accessor: ServicesAccessor,
		args: ParsedArgs
	): Promise<Result<void, Error>>;
}
