import { RojoTree } from "../../rojo/rojo-tree.js";

export interface TreeAssembly {
	readonly tree: RojoTree;
	/** Directories written as one `$path`, mapped to the instance each becomes. */
	readonly collapsed: ReadonlyMap<string, readonly string[]>;
}
