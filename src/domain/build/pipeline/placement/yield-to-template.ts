import { PreparedBuild } from "../../model/build-phases.js";
import { LeftOut, RoutedFile } from "../../model/routed.js";
import { RojoProject } from "../../../rojo/rojo-project.js";

export interface TemplateYield {
	readonly files: readonly RoutedFile[];
	readonly leftOut: ReadonlyMap<string, LeftOut>;
}

/** Leaves out the files whose node the template already defines; the template wins. */
export function yieldToTemplate(
	{ template }: Pick<PreparedBuild, "template">,
	placed: readonly RoutedFile[]
): TemplateYield {
	const files: RoutedFile[] = [];
	const leftOut = new Map<string, LeftOut>();
	for (const file of placed) {
		const node = displacingNode(template, file);
		if (node) leftOut.set(file.entry.source, { status: "displaced", node });
		else files.push(file);
	}
	return { files, leftOut };
}

/** The file's own node, or a folder of its that the template gives a `$path`, which is that folder's whole content. */
function displacingNode(
	template: RojoProject,
	file: RoutedFile
): readonly string[] | undefined {
	const folder = file.folderNodes.find(
		({ instancePath }) =>
			template.getNode(instancePath)?.$path !== undefined
	);
	if (folder) return folder.instancePath;
	return template.getNode(file.instancePath) ? file.instancePath : undefined;
}
