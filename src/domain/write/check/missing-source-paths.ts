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

export class MissingSourcePaths {
	constructor(
		private readonly sourcePaths: readonly CheckedSourcePath[],
		private readonly projectFile: string,
		private readonly isDefault = false
	) {}

	get stopsWrite(): boolean {
		return (
			this.sourcePaths.length > 0 &&
			this.sourcePaths.every(({ exists }) => !exists)
		);
	}

	diagnostics(): Diagnostic[] {
		return this.stopsWrite ? this.errors() : this.warnings();
	}

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
				`no source path of the config exists, so ${path.basename(this.projectFile)} was left as it was. ${this.isDefault ? `Create ${path.basename(sourcePath)}, or set "sourcePaths" to where your code is.` : 'Check the spelling in "sourcePaths".'}`
			)
		);
	}

	private missing(): CheckedSourcePath[] {
		return this.sourcePaths.filter(({ exists }) => !exists);
	}
}
