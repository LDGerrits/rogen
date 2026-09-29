import { joinPosix } from "../../../../base/path.js";
import { instanceKey } from "../../../rojo/rojo-tree.js";
import { BuildRule, RoutedFile } from "../../build-record.js";
import { TreeDiagnostics } from "../../tree-diagnostics.js";

/** One warning per template node and the file or folder it displaced. */
export const templateClash: BuildRule = ({ config, routed, leftOut }) => {
	const clashes = new Map<string, { instance: string; source: string }>();
	for (const file of routed) {
		const why = leftOut.get(file.entry.source);
		if (why?.status !== "displaced") continue;
		const instance = instanceKey(why.node);
		const source = namingSource(file, why.node);
		clashes.set(`${instance}\0${source}`, { instance, source });
	}
	return [...clashes.values()].map(({ instance, source }) =>
		TreeDiagnostics.templateClash(
			{ resource: config.outFile },
			instance,
			source
		)
	);
};

/** The file itself, or the folder of the file that names the node. */
function namingSource(file: RoutedFile, node: readonly string[]): string {
	const folder = file.folderNodes.find(
		({ instancePath }) => instanceKey(instancePath) === instanceKey(node)
	);
	return folder
		? joinPosix(file.entry.rootDir, folder.dir)
		: file.entry.source;
}
