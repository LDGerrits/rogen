import { joinPosix } from "../../../../base/path.js";
import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { instanceKey } from "../../../rojo/rojo-tree.js";
import { RoutedFile } from "../../model/routed.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

/** One warning per template node and the file or folder it displaced. */
export const templateClash: BuildRule = {
	id: "template-clash",
	order: 110,
	check: ({ config, routed, leftOut }) => {
		const clashes = new Map<string, { instance: string; source: string }>();
		for (const file of routed) {
			const why = leftOut.get(file.entry.source);
			if (why?.status !== "displaced") continue;
			const instance = instanceKey(why.node);
			const source = namingSource(file, why.node);
			clashes.set(`${instance}\0${source}`, { instance, source });
		}
		return [...clashes.values()].map(({ instance, source }) =>
			warningDiagnostic(
				"tree.templateClash",
				{ resource: config.outFile },
				`"${instance}" is defined by both the template and ${source}, so the template's is kept and ${source} is left out. Rename one of them to keep both.`
			)
		);
	},
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

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(templateClash);
