import path from "path";
import { samePath } from "../../base/path.js";
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

/** Whether the two configs read at least one folder in common. */
const sharesSourcePath = (a: ResolvedConfig, b: ResolvedConfig): boolean =>
	a.sourcePaths.some((mine) =>
		b.sourcePaths.some((theirs) => samePath(mine, theirs))
	);

/** The errors for `mine` where a sibling config of its folder is a forgotten copy: it names the same project and either repeats it entirely or reads none of its source paths. */
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
		} else if (
			mine.config.sourcePaths.length > 0 &&
			sibling.config.sourcePaths.length > 0 &&
			!sharesSourcePath(mine.config, sibling.config)
		) {
			found.push(
				errorDiagnostic(
					"config.duplicateName",
					location,
					`${files} are both named "${mine.config.projectName}" but share no source path, so Studio and Rojo would list two games under one name. Change "name" in the copy.`
				)
			);
		}
	}
	return found;
}
