import path from "path";
import { groupBy } from "../../base/collection.js";
import { toPosix } from "../../base/path.js";
import { generateUuid } from "../../base/uuid.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";

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
};

export interface OutputTarget {
	/** The config file, used to name it in the error. */
	readonly file: string;
	readonly outFile: string;
}

export function findOutputClashes(
	configs: readonly OutputTarget[]
): Diagnostic[] {
	const byOutFile = groupBy(
		configs,
		({ outFile }) => path.resolve(outFile),
		({ file }) => file
	);

	return [...byOutFile]
		.filter(([, files]) => files.length > 1)
		.map(([outFile, files]) =>
			OutputDiagnostics.sameOutFile(
				{ resource: outFile },
				files.map((file) => `"${path.basename(file)}"`)
			)
		);
}

/** A fresh file to stage a write of `outFile` through, so concurrent writers never share one. */
export function stagingFile(outFile: string): string {
	return `${outFile}.${generateUuid()}.tmp`;
}

/** Matches the staging file of any writer of `outFile`, in posix form. */
export function stagingPattern(outFile: string): RegExp {
	const escaped = toPosix(outFile).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped}\\.[^/]+\\.tmp$`);
}
