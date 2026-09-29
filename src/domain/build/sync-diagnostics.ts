import {
	Diagnostic,
	DiagnosticLocation,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { MetaReplacement } from "../toolchain/toolchain.js";
import { listPaths } from "./rules/path-list.js";

/** Problems with what the sync dir holds, which Rojo reads instead of the root dirs. */
export const SyncDiagnostics = {
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
		conversion?: MetaReplacement & { readonly count: number }
	): Diagnostic => {
		const them = paths.length === 1 ? "it" : "them";
		return warningDiagnostic(
			"output.metaNotSynced",
			location,
			`${paths.length} meta ${paths.length === 1 ? "file has" : "files have"} no copy under "${syncDir}" (${listPaths(paths)}), so Rojo doesn't apply ${them}. ` +
				(conversion
					? `The processor turned ${conversion.count === paths.length ? them : `${conversion.count} of them`} into ${conversion.suffix}, which Rojo syncs as a ModuleScript instead of applying. ${conversion.note}`
					: "Have the compiler copy .meta.json files into its output.")
		);
	},
};
