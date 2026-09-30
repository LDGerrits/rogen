import path from "path";
import { ResolvedConfig } from "../config/config.js";
import { containerClassName } from "../roblox/roblox.js";
import { RojoNode, RojoProject } from "../rojo/rojo-project.js";
import { relativeToProject } from "./sync-layout.js";

/** The template with its `$path`s rebased to `projectDir`, or a bare DataModel without one. */
export function templateProject(
	config: Pick<ResolvedConfig, "name" | "template">,
	projectDir: string
): RojoProject {
	const { template } = config;
	const tree = template?.project.getTree().tree ?? {
		$className: "DataModel",
	};
	const rebased = new RojoProject(
		{ name: config.name, tree },
		generatedContainer
	);
	if (template && path.dirname(template.file) !== projectDir) {
		const templateDir = path.dirname(template.file);
		rebased.mapPaths((target) =>
			rebaseTemplatePath(target, templateDir, projectDir)
		);
	}
	return rebased;
}

/** Studio can't drift from disk inside a folder Rogen owns, so unknown children are removed on sync. */
export function generatedContainer(instancePath: readonly string[]): RojoNode {
	const $className = containerClassName(instancePath);
	return $className === "Folder"
		? { $className, $ignoreUnknownInstances: false }
		: { $className };
}

export function templateGlobs(
	config: Pick<ResolvedConfig, "template">,
	projectDir: string
): string[] {
	const { template } = config;
	const globs = (template?.project.globIgnorePaths ?? []).filter(
		(glob) => typeof glob === "string"
	);
	if (!template || path.dirname(template.file) === projectDir) return globs;
	return globs.map((glob) =>
		relativeToProject(
			path.resolve(path.dirname(template.file), glob),
			projectDir
		)
	);
}

/**
 * A `$path` target from the template is real source on disk (Wally's
 * `Packages`, rbxts's `include`), so it is only rebased, never moved under
 * `syncDir`.
 */
function rebaseTemplatePath(
	target: string,
	templateDir: string,
	projectDir: string
): string {
	return relativeToProject(path.resolve(templateDir, target), projectDir);
}
