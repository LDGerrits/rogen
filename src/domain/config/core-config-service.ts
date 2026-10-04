import { Result, err } from "../../base/result.js";
import {
	ConfigOptions,
	ParsedArgs,
} from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ConfigDiscovery, ConfigRefs } from "./config-discovery.js";
import { ConfigLoader, ConfigOverrides } from "./config-loader.js";
import {
	ConfigEntry,
	ConfigScope,
	ConfigSelection,
	ConfigService,
} from "./config-service.js";
import { CoreConfigSelection, ManagedConfig } from "./core-config-selection.js";

/** Overrides that name one value, which several configs can't share, by the flag that sets each. */
const SINGLE_CONFIG_OVERRIDES = {
	outFile: "out-file",
	syncDir: "sync-dir",
	template: "template",
} as const;

/** The flag as a user types it, taken from the option table so the two can't drift. */
function flagOf(name: string): string {
	const short = ConfigOptions.find((option) => option.name === name)?.short;
	return short ? `-${short}` : `--${name}`;
}

/** The overrides the command line's flags set; `-T` beats `-t` for one tag. */
function overridesOf(args: ParsedArgs): ConfigOverrides {
	return {
		outFile: args["out-file"],
		syncDir: args["sync-dir"],
		template: args.template,
		tags: {
			...Object.fromEntries((args.tag ?? []).map((tag) => [tag, true])),
			...Object.fromEntries(
				(args["no-tag"] ?? []).map((tag) => [tag, false])
			),
		},
	};
}

/** Why `refs` can't be loaded together, before any config is read. */
function selectionProblem(
	{ names, paths = [], all }: ConfigRefs,
	overrides: ConfigOverrides
): Error | undefined {
	if (all && names.length + paths.length > 0) {
		return new Error(
			"--all already builds every config here, so it takes no names or -c paths. Drop one or the other."
		);
	}
	if (!all && names.length + paths.length <= 1) return undefined;
	const override = Object.entries(SINGLE_CONFIG_OVERRIDES).find(
		([field]) => overrides[field as keyof ConfigOverrides] !== undefined
	);
	return override
		? new Error(
				`${flagOf(override[1])} targets a single config, but several were named. Name one config, or set it in the file.`
			)
		: undefined;
}

export class CoreConfigService implements ConfigService {
	declare readonly _serviceBrand: undefined;

	private readonly discovery: ConfigDiscovery;
	private readonly loader: ConfigLoader;

	constructor(
		fileSystemService: FileSystemService,
		environmentService: EnvironmentService
	) {
		this.discovery = new ConfigDiscovery(
			fileSystemService,
			environmentService
		);
		this.loader = new ConfigLoader(fileSystemService, environmentService);
	}

	async select(
		args: ParsedArgs,
		{ names = args._.slice(1), unnamed = "default" }: ConfigScope = {}
	): Promise<Result<ConfigSelection, Error>> {
		const paths = args.config ?? [];
		const refs: ConfigRefs = {
			names,
			paths,
			all:
				args.all === true ||
				(unnamed === "all" &&
					names.length === 0 &&
					paths.length === 0),
		};
		const overrides = overridesOf(args);
		const problem = selectionProblem(refs, overrides);
		if (problem) return err(problem);

		const discovered = await this.discovery.discover(refs);
		if (discovered.isErr()) return err(discovered.error);

		return CoreConfigSelection.load(
			discovered.value,
			this.loader,
			overrides,
			await this.unselected(discovered.value)
		);
	}

	async read(file: string): Promise<ConfigEntry> {
		const config = new ManagedConfig(file, this.loader, { tags: {} });
		await config.load();
		return config.entry;
	}

	/** The config files in the working dir that aren't `selected`; none when it can't be read. */
	private async unselected(selected: readonly string[]): Promise<string[]> {
		const found = await this.discovery.find();
		const picked = new Set(selected);
		return found.isOk()
			? found.value.filter((file) => !picked.has(file))
			: [];
	}
}
