import { ResolvedConfig, leafConfigs } from "../config/config.js";

/** Which of a serve's configs it serves: the ones no other config extends, among the named ones and those that extend them, else among all. */
export class ServedConfigs {
	readonly configs: readonly ResolvedConfig[];

	constructor(
		readonly all: readonly ResolvedConfig[],
		named: ReadonlySet<string> | undefined,
		/** Configs here that the serve doesn't build, which still share project names. */
		private readonly neighbours: readonly ResolvedConfig[] = []
	) {
		const leaves = leafConfigs(all);
		this.configs = named
			? leaves.filter(
					({ file, parents }) =>
						named.has(file) ||
						parents.some((parent) => named.has(parent))
				)
			: leaves;
	}

	/** The other configs here with `config`'s project name, which a server that only says that name could be serving. */
	namesakesOf(config: ResolvedConfig): ResolvedConfig[] {
		return [...this.all, ...this.neighbours].filter(
			(other) =>
				other.file !== config.file &&
				other.projectName === config.projectName
		);
	}
}
