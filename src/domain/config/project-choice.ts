import { DEFAULT_PROJECT } from "./config.js";
import { ResolvedConfig } from "./resolved-config.js";

/** Which project of each config a command works on. */
export class ProjectChoice {
	/** The projects a command that reads a config reads: `default` unless one is named. */
	static read(
		configs: readonly ResolvedConfig[],
		named: ReadonlyMap<string, string>
	): ResolvedConfig[] {
		return ProjectChoice.of(configs, named, () => DEFAULT_PROJECT);
	}

	/** The projects `rogen serve` serves: each config's `serveProject` unless one is named. A config with places is skipped. */
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
