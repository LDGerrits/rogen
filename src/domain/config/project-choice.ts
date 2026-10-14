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

	/** The projects `rogen serve` serves: the `serveProject` of each config unless one is named. */
	static served(
		configs: readonly ResolvedConfig[],
		named: ReadonlyMap<string, string>
	): ResolvedConfig[] {
		return ProjectChoice.of(
			configs,
			named,
			({ serveProject }) => serveProject
		);
	}

	/** The one project of each config that is named for it, else the one `chosen` gives. */
	private static of(
		configs: readonly ResolvedConfig[],
		named: ReadonlyMap<string, string>,
		chosen: (config: ResolvedConfig) => string
	): ResolvedConfig[] {
		return configs.filter(
			(config) =>
				config.stem === (named.get(config.file) ?? chosen(config))
		);
	}
}
