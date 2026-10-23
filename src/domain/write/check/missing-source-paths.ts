import path from "path";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";

interface CheckedSourcePath {
	readonly sourcePath: string;
	readonly exists: boolean;
}

/** The source paths a config lists that are no folder: a warning each, or an error each when none is, since the file would be written empty over a good one. */
export class MissingSourcePaths {
	constructor(
		private readonly sourcePaths: readonly CheckedSourcePath[],
		private readonly projectFile: string,
		/** Whether the only source path is the default one, which the user may never have written. */
		private readonly isDefault = false
	) {}

	/** Whether the config lists source paths and none of them is a folder. */
	get stopsWrite(): boolean {
		return (
			this.sourcePaths.length > 0 &&
			this.sourcePaths.every(({ exists }) => !exists)
		);
	}

	/** An error each when the write stops, else a warning each. */
	diagnostics(): Diagnostic[] {
		return this.stopsWrite ? this.errors() : this.warnings();
	}

	/** A warning each, whatever the others are, for a report that does not stop. */
	warnings(): Diagnostic[] {
		return this.missing().map(({ sourcePath }) =>
			warningDiagnostic(
				"scan.missingSourcePath",
				{ resource: sourcePath },
				"this source path does not exist or is not a folder, so it contributes nothing."
			)
		);
	}

	private errors(): Diagnostic[] {
		return this.missing().map(({ sourcePath }) =>
			errorDiagnostic(
				"scan.missingSourcePath",
				{ resource: sourcePath },
				`this source path does not exist or is not a folder, and no other source path of the config does, so there is nothing to write. ${path.basename(this.projectFile)} was left as it was. ${this.isDefault ? `Create ${path.basename(sourcePath)}, or set "sourcePaths" to where your code is.` : 'Check the spelling in "sourcePaths".'}`
			)
		);
	}

	private missing(): CheckedSourcePath[] {
		return this.sourcePaths.filter(({ exists }) => !exists);
	}
}
