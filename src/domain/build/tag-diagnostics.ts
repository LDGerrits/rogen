import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { RojoScriptSuffix } from "../rojo/rojo-assigned-name.js";
import { listPaths } from "./path-list.js";

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
		paths: readonly string[]
	): Diagnostic =>
		warningDiagnostic(
			"tag.dormantCapitalSuffix",
			location,
			`${paths.length} ${paths.length === 1 ? "file" : "files"} pruned by the dormant tag "${tag}" matched on a capital suffix (${listPaths(paths)}). Use a separator (Foo.${tag}.luau) if these are not variants.`
		),

	undeclaredSuffix: (
		location: DiagnosticLocation,
		suffix: string,
		paths: readonly string[]
	): Diagnostic =>
		warningDiagnostic(
			"tag.undeclaredSuffix",
			location,
			`${paths.length} ${paths.length === 1 ? "file ends" : "files end"} in "${suffix}" (${listPaths(paths)}), which looks like a tag but isn't declared under "tags", so it stays in the name.`
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
