import { ResolvedConfig } from "../config/config.js";

/** Which of a serve's configs it serves: the ones named on the command line, else the leaves. */
export class ServedConfigs {
	readonly configs: readonly ResolvedConfig[];
	private readonly servable: ReadonlySet<ResolvedConfig>;

	constructor(
		readonly all: readonly ResolvedConfig[],
		named: ReadonlySet<string> | undefined
	) {
		const leaves = leafConfigs(all);
		this.configs = named
			? all.filter(({ file }) => named.has(file))
			: leaves;
		this.servable = new Set([...leaves, ...this.configs]);
	}

	/** Whether several configs a server could serve here have `project`'s name, so a server of that name can't be told apart. */
	sharesName(project: string): boolean {
		return (
			[...this.servable].filter(({ name }) => name === project).length > 1
		);
	}
}

/** The configs a serve starts a server for: the leaves, which no other config of `configs` extends. That picks the synced config over its source-rooted base, and each place over the config they share. */
function leafConfigs(configs: readonly ResolvedConfig[]): ResolvedConfig[] {
	const extended = new Set(configs.flatMap(({ parents }) => parents));
	return configs.filter(({ file }) => !extended.has(file));
}
