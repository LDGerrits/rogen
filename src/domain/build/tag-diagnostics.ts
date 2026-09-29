import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { RojoScriptSuffix } from "../rojo/rojo-assigned-name.js";

export const TagDiagnostics = {
	activeClash: (
		location: DiagnosticLocation,
		instance: string,
		paths: readonly string[]
	): Diagnostic =>
		errorDiagnostic(
			"tag.activeClash",
			location,
			`${paths.length} files with active tags all become "${instance}" (${paths.join(", ")}). Only one can apply: turn a tag off or rename a file.`
		),

	untaggedClash: (
		location: DiagnosticLocation,
		instance: string,
		paths: readonly string[]
	): Diagnostic =>
		warningDiagnostic(
			"tag.untaggedClash",
			location,
			`${paths.length} files all become "${instance}" (${paths.join(", ")}), so only the last one is used.`
		),

	dormantCapitalSuffix: (
		location: DiagnosticLocation,
		tag: string,
		variantName: string
	): Diagnostic =>
		warningDiagnostic(
			"tag.dormantCapitalSuffix",
			location,
			`pruned because its capital suffix matches the dormant tag "${tag}". If it's a variant, name it ${variantName}; if not, rename it so it doesn't end in "${tag[0].toUpperCase()}${tag.slice(1)}".`
		),

	moreDormantCapitalSuffixes: (
		location: DiagnosticLocation,
		tag: string,
		count: number
	): Diagnostic =>
		warningDiagnostic(
			"tag.dormantCapitalSuffix",
			location,
			`${count} more ${count === 1 ? "file was" : "files were"} pruned by the dormant tag "${tag}" on a capital suffix. Run 'rogen where' to list them all.`
		),

	buriedScriptSuffix: (
		location: DiagnosticLocation,
		suffix: RojoScriptSuffix
	): Diagnostic =>
		warningDiagnostic(
			"tag.buriedScriptSuffix",
			location,
			`".${suffix}" isn't this file's last suffix, so Rojo will make it a ModuleScript. Put it last, as in Foo.mock.${suffix}.luau.`
		),
};
