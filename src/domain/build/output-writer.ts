import { failureReason } from "../../base/errors.js";
import { randomUUID } from "crypto";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { PROJECT_SCHEMA_URL } from "../config/config.js";
import { ProjectText } from "../rojo/project-text.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { OutputFile } from "./build.js";

/** Writes a tree to its output through a staging file, so a reader never sees half a project file. */
export class OutputWriter {
	constructor(private readonly fileSystemService: FileSystemService) {}

	/** The bytes a project file is written as. */
	static textOf(projectFile: RojoProjectFile): string {
		return ProjectText.of(projectFile, PROJECT_SCHEMA_URL);
	}

	/** Whether the file changed; unchanged bytes are left alone. */
	async write(
		output: OutputFile,
		tree: RojoProjectFile
	): Promise<Result<boolean, DiagnosticsError>> {
		const projectFile = output.path;
		const content = OutputWriter.textOf(tree);
		// A fresh staging file per write, so concurrent writers never share one.
		const temporary = output.stagingFile(randomUUID());

		const written = await tryWithAsync(async (): Promise<boolean> => {
			if (
				(await this.fileSystemService.isFile(projectFile)) &&
				(await this.fileSystemService.readFile(projectFile)) === content
			) {
				return false;
			}
			await this.fileSystemService.writeFile(temporary, content);
			await this.fileSystemService.rename(temporary, projectFile, true);
			return true;
		});
		if (written.isOk()) return ok(written.value);

		await this.fileSystemService.delete(temporary).catch(() => undefined);
		return err(
			new DiagnosticsError([
				errorDiagnostic(
					"output.writeFailed",
					{ resource: projectFile },
					`the project file could not be written: ${failureReason(written.error)}.`
				),
			])
		);
	}
}
