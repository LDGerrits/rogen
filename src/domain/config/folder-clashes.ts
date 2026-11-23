import path from "path";
import { isSameJson } from "../../base/objects.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "./resolved-config.js";

export interface FolderConfig {
	readonly config: ResolvedConfig;
	readonly value: Readonly<Record<string, unknown>>;
}

function withoutNameAndSourcePaths(value: Readonly<Record<string, unknown>>) {
	const { name: _name, sourcePaths: _sourcePaths, ...rest } = value;
	return rest;
}

const sourcesOf = (config: ResolvedConfig): string[] =>
	[...config.sourcePaths].sort();

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
			isSameJson(
				withoutNameAndSourcePaths(mine.value),
				withoutNameAndSourcePaths(sibling.value)
			)
		) {
			found.push(
				errorDiagnostic(
					"config.identicalConfig",
					location,
					`${files} are the same config. Edit the copy, or delete it.`
				)
			);
		}
	}
	return found;
}
