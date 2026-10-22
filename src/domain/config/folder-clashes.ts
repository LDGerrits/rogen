import path from "path";
import { isObject, isSameJson } from "../../base/objects.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ROGEN_BLOCK } from "./config.js";
import { ResolvedConfig } from "./resolved-config.js";

/** One config of a folder as it loaded. */
export interface FolderConfig {
	readonly config: ResolvedConfig;
	/** What the file holds. */
	readonly value: Readonly<Record<string, unknown>> | undefined;
}

/** What a config says apart from its name and source paths, so two configs that differ in routes, tree or any other key are two outputs. */
function otherKeys(value: Readonly<Record<string, unknown>> | undefined) {
	const { name: _name, [ROGEN_BLOCK]: block, ...rest } = value ?? {};
	if (!isObject(block)) return rest;
	const { sourcePaths: _sourcePaths, ...others } = block;
	return Object.keys(others).length > 0
		? { ...rest, [ROGEN_BLOCK]: others }
		: rest;
}

const sourcesOf = (config: ResolvedConfig): string[] =>
	[...config.sourcePaths].sort();

/** The errors for `mine` where a sibling config of its folder is a forgotten copy: it names the same project and differs in nothing but, at most, its source paths. */
export function folderClashes(
	mine: FolderConfig,
	siblings: readonly FolderConfig[]
): Diagnostic[] {
	const found: Diagnostic[] = [];
	for (const sibling of siblings) {
		if (mine.config.projectName !== sibling.config.projectName) continue;
		if (!isSameJson(otherKeys(mine.value), otherKeys(sibling.value)))
			continue;
		const files = `${path.basename(sibling.config.file)} and ${path.basename(mine.config.file)}`;
		const location = { resource: mine.config.file };
		found.push(
			isSameJson(sourcesOf(mine.config), sourcesOf(sibling.config))
				? errorDiagnostic(
						"config.identicalConfig",
						location,
						`${files} are the same config: a copy that was not edited. Change "name", "sourcePaths" and what else the copy is for, or delete it.`
					)
				: errorDiagnostic(
						"config.duplicateName",
						location,
						`${files} are both named "${mine.config.projectName}" but read other source paths, so Studio and Rojo would list two games under one name. Change "name" in the copy.`
					)
		);
	}
	return found;
}
