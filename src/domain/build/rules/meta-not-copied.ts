import path from "path";
import { joinPosix } from "../../../base/path.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { INIT_META_FILE } from "../../rojo/rojo-files.js";
import { BuildRule, FolderMeta, RoutedFile } from "../build-record.js";
import { MetaDiagnostics } from "../meta-diagnostics.js";
import { metaFileFor } from "./unclaimed-meta.js";

/** Folder meta the build couldn't copy: a file is what Rojo reads at the node, or the template's `$path` is. */
export const metaNotCopied: BuildRule = ({ metaOutcomes }) =>
	metaOutcomes.flatMap((outcome) => {
		if (outcome.kind === "shared")
			return outcome.metas.map((meta) =>
				sharedWithFile(meta, outcome.file, outcome.instance)
			);
		if (outcome.kind === "templatePath")
			return [
				MetaDiagnostics.templatePath(
					{ resource: outcome.meta.file },
					outcome.instance
				),
			];
		return [];
	});

function sharedWithFile(
	meta: FolderMeta,
	file: RoutedFile,
	instance: string
): Diagnostic {
	const { entry } = file;
	if (entry.kind === "init-folder")
		return MetaDiagnostics.sharedWithInitFolder(
			{ resource: meta.file },
			instance,
			joinPosix(entry.source, INIT_META_FILE)
		);
	const fileName = path.posix.basename(entry.relativePath);
	return MetaDiagnostics.sharedWithScript(
		{ resource: meta.file },
		instance,
		fileName,
		metaFileFor(fileName) ?? `${fileName}.meta.json`
	);
}
