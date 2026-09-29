import path from "path";
import { joinPosix } from "../../../../base/path.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { rojoMetaFile } from "../../../rojo/rojo-assigned-name.js";
import { INIT_META_FILE } from "../../../rojo/rojo-files.js";
import { FolderMeta, RoutedFile } from "../../build-record.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

/** Folder meta the build couldn't copy: a file is what Rojo reads at the node, or the template's `$path` is. */
export const metaNotCopied: BuildRule = {
	id: "meta-not-copied",
	order: 120,
	check: ({ metaOutcomes }) =>
		metaOutcomes.flatMap((outcome) => {
			if (outcome.kind === "shared")
				return outcome.metas.map((meta) =>
					sharedWithFile(meta, outcome.file, outcome.instance)
				);
			if (outcome.kind === "templatePath")
				return [
					warningDiagnostic(
						"meta.templatePath",
						{ resource: outcome.meta.file },
						`the template gives "${outcome.instance}" its own $path, so this meta isn't copied there. Set the fields on the template's node instead.`
					),
				];
			return [];
		}),
};

function sharedWithFile(
	meta: FolderMeta,
	file: RoutedFile,
	instance: string
): Diagnostic {
	const { entry } = file;
	const location = { resource: meta.file };
	if (entry.kind === "init-folder")
		return warningDiagnostic(
			"meta.sharedWithScript",
			location,
			`this folder shares "${instance}" with an init folder, which is what Rojo reads there, so its meta applies to nothing. Put it in ${joinPosix(entry.source, INIT_META_FILE)} instead.`
		);
	const fileName = path.posix.basename(entry.relativePath);
	const fix = rojoMetaFile(fileName) ?? `${fileName}.meta.json`;
	return warningDiagnostic(
		"meta.sharedWithScript",
		location,
		`this folder shares "${instance}" with ${fileName}, which is what Rojo reads there, so its meta applies to nothing. Put it in ${fix} beside the script, or turn the folder into an init folder.`
	);
}

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(metaNotCopied);
