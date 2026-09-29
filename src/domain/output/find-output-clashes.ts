import path from "path";
import { groupBy } from "../../base/collection.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { OutputDiagnostics } from "./output-diagnostics.js";

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
