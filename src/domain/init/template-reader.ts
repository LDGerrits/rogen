import path from "path";
import { failureReason } from "../../base/errors.js";
import { Result, err, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	FileReader,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";

/** Reads a hand-written project file `init` copies, as it is. */
export class TemplateReader {
	constructor(
		private readonly fileReader: FileReader,
		/** The directory `init` runs in. */
		private readonly directory: string
	) {}

	async read(fileName: string): Promise<Result<string, Diagnostic[]>> {
		const file = path.join(this.directory, fileName);
		const text = await tryWithAsync(() => this.fileReader.readFile(file));
		return text.isOk()
			? text
			: err([
					errorDiagnostic(
						"init.templateUnreadable",
						{ resource: file },
						isMissingPath(text.error)
							? "this file does not exist, so it can't be copied."
							: `couldn't read this file to copy it: ${failureReason(text.error)}.`
					),
				]);
	}
}
