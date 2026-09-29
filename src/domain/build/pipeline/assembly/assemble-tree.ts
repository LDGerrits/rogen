import { compareStrings } from "../../../../base/collection.js";
import { RojoProject } from "../../../rojo/rojo-project.js";
import { RojoTree } from "../../../rojo/rojo-tree.js";
import { isReadOnly, syncPath } from "../../layout/sync-path.js";
import { generatedContainer, templateGlobs } from "../../layout/template.js";
import { PlacedBuild } from "../../model/build-phases.js";
import { TreeAssembly } from "../../model/tree-assembly.js";
import { collapsibleDirs, isCollapsed } from "./collapse-folders.js";

/** Merges the placed files into the template, collapsing a directory into one `$path` where Rojo would see the same files. */
export function assembleTree({
	config,
	layout,
	template,
	files,
	leftOut: allLeftOut,
}: Pick<
	PlacedBuild,
	"config" | "layout" | "template" | "files" | "leftOut"
>): TreeAssembly {
	const project = new RojoProject(template.getTree(), generatedContainer);
	const leftOut = [...allLeftOut].filter(
		([source]) => !isReadOnly(source, layout)
	);
	// A replaced file may share the winner's emitted path, and the template may mount a displaced one.
	const ignored = leftOut
		.filter(
			([, why]) => why.status !== "replaced" && why.status !== "displaced"
		)
		.map(([source]) => source)
		.sort(compareStrings);
	const collapsed = collapsibleDirs(
		files,
		leftOut.map(([source]) => source),
		(instancePath) => template.getNode(instancePath) !== undefined
	);

	for (const [dir, instancePath] of collapsed)
		project.insertNode(instancePath, { $path: syncPath(dir, layout) });
	for (const { entry, instancePath } of files) {
		if (isCollapsed(entry.source, collapsed)) continue;
		project.insertNode(instancePath, {
			$path: syncPath(entry.source, layout),
		});
	}

	const globIgnorePaths = [
		...new Set([
			...templateGlobs(config, layout.projectDir),
			...ignored.map((source) => syncPath(source, layout).optional),
		]),
	];
	const tree: RojoTree = {
		...config.template?.project,
		name: config.name,
		tree: project.getTree().tree,
	};
	if (globIgnorePaths.length > 0) tree.globIgnorePaths = globIgnorePaths;
	else delete tree.globIgnorePaths;
	return { tree, collapsed };
}
