import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { listPaths } from "./path-list.js";
import { UnclaimedMeta } from "./unclaimed-meta.js";

export type InstancelessFolder =
	"root dir" | "routing folder" | "tag folder" | "invisible folder";

export interface InstancelessMeta {
	readonly file: string;
	readonly kind: InstancelessFolder;
}

export const MetaDiagnostics = {
	unreadable: (location: DiagnosticLocation, detail: string): Diagnostic =>
		errorDiagnostic(
			"meta.unreadable",
			location,
			`the meta file could not be read: ${detail}.`
		),

	invalidSyntax: (location: DiagnosticLocation, detail: string): Diagnostic =>
		errorDiagnostic(
			"meta.invalidSyntax",
			location,
			`invalid JSONC: ${detail}.`
		),

	notAnObject: (location: DiagnosticLocation): Diagnostic =>
		errorDiagnostic(
			"meta.notAnObject",
			location,
			"a meta file must be a JSON object."
		),

	wrongType: (
		location: DiagnosticLocation,
		field: string,
		expected: string,
		found: string
	): Diagnostic =>
		errorDiagnostic(
			"meta.wrongType",
			location,
			`"${field}": expected ${expected}, found ${found}.`
		),

	unclaimed: (
		location: DiagnosticLocation,
		unclaimed: readonly UnclaimedMeta[]
	): Diagnostic => {
		const entries = unclaimed.map(({ path, hint }) =>
			hint ? `${path} (${hint})` : path
		);
		return warningDiagnostic(
			"meta.unclaimed",
			location,
			`${entries.length} meta ${entries.length === 1 ? "file belongs" : "files belong"} to no file, so Rojo ignores ${entries.length === 1 ? "it" : "them"} (${listPaths(entries)}). A file's meta is named after the name Rojo gives the file, without .server, .client or .plugin.`
		);
	},

	sameNode: (
		location: DiagnosticLocation,
		instance: string,
		files: readonly string[]
	): Diagnostic =>
		errorDiagnostic(
			"meta.sameNode",
			location,
			`${files.join(" and ")} both apply to "${instance}" from one root dir, and neither ranks above the other. Keep one of them.`
		),

	idOnSeveralNodes: (
		location: DiagnosticLocation,
		id: string,
		instances: readonly string[]
	): Diagnostic =>
		errorDiagnostic(
			"meta.idOnSeveralNodes",
			location,
			`id "${id}" would be copied onto ${instances.length} instances (${instances.join(", ")}), but a ref must be unique. Remove the id, or keep the folder's files in one service.`
		),

	sharedWithScript: (
		location: DiagnosticLocation,
		instance: string,
		fileName: string,
		fix: string
	): Diagnostic =>
		warningDiagnostic(
			"meta.sharedWithScript",
			location,
			`this folder shares "${instance}" with ${fileName}, which is what Rojo reads there, so its meta applies to nothing. Put it in ${fix} beside the script, or turn the folder into an init folder.`
		),

	sharedWithInitFolder: (
		location: DiagnosticLocation,
		instance: string,
		initMeta: string
	): Diagnostic =>
		warningDiagnostic(
			"meta.sharedWithScript",
			location,
			`this folder shares "${instance}" with an init folder, which is what Rojo reads there, so its meta applies to nothing. Put it in ${initMeta} instead.`
		),

	templatePath: (
		location: DiagnosticLocation,
		instance: string
	): Diagnostic =>
		warningDiagnostic(
			"meta.templatePath",
			location,
			`the template gives "${instance}" its own $path, so this meta isn't copied there. Set the fields on the template's node instead.`
		),

	templateClass: (
		location: DiagnosticLocation,
		instance: string,
		templateClass: string,
		metaFile: string,
		metaClass: string
	): Diagnostic =>
		warningDiagnostic(
			"meta.templateClass",
			location,
			`the template makes "${instance}" a ${templateClass}, but ${metaFile} makes it a ${metaClass}, so the template's class is kept.`
		),

	appliesToNothing: (
		location: DiagnosticLocation,
		metas: readonly InstancelessMeta[]
	): Diagnostic =>
		warningDiagnostic(
			"meta.appliesToNothing",
			location,
			`${metas.length} init.meta.json ${metas.length === 1 ? "file applies" : "files apply"} to nothing, because ${metas.length === 1 ? "its folder never becomes" : "their folders never become"} an instance (${listPaths(metas.map(({ file, kind }) => `${file} (${kind})`))}). Move the meta into the folder that should get it.`
		),
};
