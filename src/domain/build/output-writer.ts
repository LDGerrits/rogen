import { randomUUID } from "crypto";
import { stableStringify } from "../../base/json.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { RojoTree } from "../rojo/rojo-project.js";
import { OutputFile } from "./build.js";

/** Writes a tree to its output through a staging file, so a reader never sees half a project file. */
export class OutputWriter {
	constructor(private readonly fileSystemService: FileSystemService) {}

	/** Whether the file changed; unchanged bytes are left alone. */
	async write(
		output: OutputFile,
		tree: RojoTree
	): Promise<Result<boolean, DiagnosticsError>> {
		const outFile = output.path;
		const content = `${stableStringify(tree)}\n`;
		// A fresh staging file per write, so concurrent writers never share one.
		const temporary = output.stagingFile(randomUUID());

		const written = await tryWithAsync(async () => {
			if (
				(await this.fileSystemService.isFile(outFile)) &&
				(await this.fileSystemService.readFile(outFile)) === content
			) {
				return false;
			}
			await this.fileSystemService.writeFile(temporary, content);
			await this.fileSystemService.rename(temporary, outFile, true);
			return true;
		});
		if (written.isOk()) return ok(written.value);

		await this.fileSystemService.delete(temporary).catch(() => undefined);
		return err(
			new DiagnosticsError([
				errorDiagnostic(
					"output.writeFailed",
					{ resource: outFile },
					`the project file could not be written: ${written.error.message}`
				),
			])
		);
	}
}
