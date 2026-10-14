import { DEFAULT_PROJECT, ResolvedConfig } from "./config.js";

/** Which project of each config a command works on. */
export class ProjectChoice {
	/** The projects a command that reads a config reads: `default` unless one is named. */
	static read(
		configs: readonly ResolvedConfig[],
		named: ReadonlyMap<string, string>
	): ResolvedConfig[] {
		return ProjectChoice.of(configs, named, () => DEFAULT_PROJECT);
	}

	/** The projects `rogen serve` serves: the `serveProject` of each config unless one is named. A config that lists places is not served; its places are. */
	static served(
		configs: readonly ResolvedConfig[],
		named: ReadonlyMap<string, string>
	): ResolvedConfig[] {
		return ProjectChoice.of(
			configs.filter(({ hasPlaces }) => !hasPlaces),
			named,
			({ serveProject }) => serveProject
		);
	}

	/** The one project of each config that is named for it, else the one `chosen` gives. A project named for a config file is named for its places too. */
	private static of(
		configs: readonly ResolvedConfig[],
		named: ReadonlyMap<string, string>,
		chosen: (config: ResolvedConfig) => string
	): ResolvedConfig[] {
		return configs.filter(
			(config) =>
				config.stem === (named.get(config.rootFile) ?? chosen(config))
		);
	}
}
