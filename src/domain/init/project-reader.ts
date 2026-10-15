import path from "path";
import { failureReason } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	FileReader,
	isFileType,
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

	/** `project` told which of the folders it mounts hold an init file, since Rojo reads such a folder as one instance. */
	async withInitFolders(project: StarterProject): Promise<StarterProject> {
		const holding: string[] = [];
		for (const folder of project.mountedFolders()) {
			const entries = await tryWithAsync(() =>
				this.fileReader.readDirectory(path.join(this.directory, folder))
			);
			if (
				entries.isOk() &&
				entries.value.some(
					([name, type]) =>
						isFileType(type) &&
						/^init\./.test(name) &&
						!name.endsWith(".d.ts")
				)
			)
				holding.push(folder);
		}
		return project.withInitIn(holding);
	}

	private unreadable(file: string, message: string): Diagnostic {
		return errorDiagnostic(
			"init.projectUnreadable",
			{ resource: file },
			message
		);
	}
}
