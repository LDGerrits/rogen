import path from "path";
import { failureReason } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	FileReader,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import { StarterProject } from "./starter-project.js";

export class ProjectReader {
	constructor(
		private readonly fileReader: FileReader,
		private readonly directory: string
	) {}

	async read(
		fileName: string
	): Promise<Result<StarterProject, Diagnostic[]>> {
		const file = path.join(this.directory, fileName);
		const text = await tryWithAsync(() => this.fileReader.readFile(file));
		if (text.isErr())
			return err([
				this.unreadable(
					file,
					isMissingPath(text.error)
						? "this file does not exist, so it can't be lifted."
						: `couldn't read this file to lift it: ${failureReason(text.error)}.`
				),
			]);
		const project = StarterProject.parse(text.value);
		return project.isOk()
			? ok(project.value)
			: err([
					this.unreadable(
						file,
						`this is not a valid project file, so it can't be lifted: ${failureReason(project.error)}`
					),
				]);
	}

	private unreadable(file: string, message: string): Diagnostic {
		return errorDiagnostic(
			"init.projectUnreadable",
			{ resource: file },
			message
		);
	}
}
