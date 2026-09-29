import { ok } from "../../../../base/result.js";
import { RojoProject } from "../../../rojo/rojo-project.js";
import { LeftOut, PlacementStage, RoutedFile } from "../../build-record.js";

/** Leaves out the files whose node the template already defines; the template wins. */
export const yieldToTemplate: PlacementStage = (build) => {
	const files: RoutedFile[] = [];
	const displaced: [string, LeftOut][] = [];
	for (const file of build.files) {
		const node = displacingNode(build.template, file);
		if (node)
			displaced.push([file.entry.source, { status: "displaced", node }]);
		else files.push(file);
	}
	return ok({
		...build,
		files,
		leftOut: new Map([...build.leftOut, ...displaced]),
	});
};

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
