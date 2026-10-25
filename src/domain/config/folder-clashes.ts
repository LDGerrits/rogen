import path from "path";
import { isSameJson } from "../../base/objects.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "./resolved-config.js";

/** One config of a folder as it loaded. */
export interface FolderConfig {
	readonly config: ResolvedConfig;
	/** What the file holds. */
	readonly value: Readonly<Record<string, unknown>> | undefined;
}

/** What a config says apart from its name and source paths, so two configs that differ in routes, tree or any other key are two outputs. */
function otherKeys(value: Readonly<Record<string, unknown>> | undefined) {
	const { name: _name, sourcePaths: _sourcePaths, ...rest } = value ?? {};
	return rest;
}

const sourcesOf = (config: ResolvedConfig): string[] =>
	[...config.sourcePaths].sort();

/** The errors for `mine` where a sibling config of its folder is a copy that was not edited: it names the same project and repeats it entirely. */
export function folderClashes(
	mine: FolderConfig,
	siblings: readonly FolderConfig[]
): Diagnostic[] {
	const found: Diagnostic[] = [];
	for (const sibling of siblings) {
		if (mine.config.projectName !== sibling.config.projectName) continue;
		const files = `${path.basename(sibling.config.file)} and ${path.basename(mine.config.file)}`;
		const location = { resource: mine.config.file };
		if (
			isSameJson(sourcesOf(mine.config), sourcesOf(sibling.config)) &&
			isSameJson(otherKeys(mine.value), otherKeys(sibling.value))
		) {
			found.push(
				errorDiagnostic(
					"config.identicalConfig",
					location,
					`${files} are the same config: a copy that was not edited. Change "name", "sourcePaths" and what else the copy is for, or delete it.`
				)
			);
		}
	}
	return found;
}
