import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { listPaths } from "../build/path-list.js";

export const OutputDiagnostics = {
	writeFailed: (location: DiagnosticLocation, detail: string): Diagnostic =>
		errorDiagnostic(
			"output.writeFailed",
			location,
			`the project file could not be written: ${detail}`
		),

	sameOutFile: (
		location: DiagnosticLocation,
		configs: readonly string[]
	): Diagnostic =>
		errorDiagnostic(
			"output.sameOutFile",
			location,
			`${configs.join(" and ")} write the same file, ${location.resource}. Give each its own "outFile".`
		),

	nothingEmitted: (
		location: DiagnosticLocation,
		rootDir: string,
		expected: string,
		nearest: { readonly found: boolean; readonly path: string }
	): Diagnostic =>
		warningDiagnostic(
			"output.nothingEmitted",
			location,
			`nothing emitted for root dir "${rootDir}" exists under "${expected}". ` +
				(nearest.found
					? `Found "${nearest.path}" — is the compiler's output rooted differently?`
					: `The nearest path that exists is "${nearest.path}" — has the compiler run?`)
		),

	metaNotSynced: (
		location: DiagnosticLocation,
		syncDir: string,
		paths: readonly string[],
		converted: number
	): Diagnostic => {
		const them = paths.length === 1 ? "it" : "them";
		const convertedOf =
			converted === paths.length ? them : `${converted} of them`;
		return warningDiagnostic(
			"output.metaNotSynced",
			location,
			`${paths.length} meta ${paths.length === 1 ? "file has" : "files have"} no copy under "${syncDir}" (${listPaths(paths)}), so Rojo doesn't apply ${them}. ` +
				(converted > 0
					? `The processor turned ${convertedOf} into .meta.lua, which Rojo syncs as a ModuleScript instead of applying. Darklua converts every .meta.json this way.`
					: "Have the compiler copy .meta.json files into its output.")
		);
	},
};
