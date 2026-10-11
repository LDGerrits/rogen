import { PathSet, pathKey } from "../../base/path.js";
import { isWindows } from "../../base/platform.js";
import { ResolvedConfig, inFamilyOf, leafConfigs } from "../config/config.js";

/** Which of a serve's configs it serves: the ones no other config extends, among the named ones and those that extend them, else among all. */
export class ServedConfigs {
	readonly configs: readonly ResolvedConfig[];

	constructor(
		readonly all: readonly ResolvedConfig[],
		named: PathSet | undefined,
		/** Configs here that the serve doesn't build, which still share project names. */
		private readonly neighbours: readonly ResolvedConfig[] = [],
		private readonly caseInsensitive = isWindows
	) {
		const leaves = leafConfigs(all, caseInsensitive);
		this.configs = named
			? leaves.filter((config) => inFamilyOf(config, named))
			: leaves;
	}

	/** The other configs here with `config`'s project name, which a server that only says that name could be serving. */
	namesakesOf(config: ResolvedConfig): ResolvedConfig[] {
		const key = pathKey(config.file, this.caseInsensitive);
		return [...this.all, ...this.neighbours].filter(
			(other) =>
				pathKey(other.file, this.caseInsensitive) !== key &&
				other.projectName === config.projectName
		);
	}
}
