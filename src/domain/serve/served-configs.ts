import { ResolvedConfig, leafConfigs } from "../config/config.js";

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
			[...this.servable].filter(
				({ projectName: name }) => name === project
			).length > 1
		);
	}
}
