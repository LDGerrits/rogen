import { failureReason } from "../../base/errors.js";
import { randomUUID } from "crypto";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import {
	FileSystemService,
	replaceFile,
} from "../../platform/fs/file-system-service.js";
import { ProjectText } from "../rojo/project-text.js";
import { RojoProjectFile } from "../rojo/rojo-project.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { OutputFile } from "./write.js";
import {
	PLACEHOLDER_SOURCE,
	Placeholder,
	placeholderState,
} from "./compiled-layout.js";

export interface OutputWriteOptions {
	readonly force?: boolean;
	readonly placeholders?: readonly Placeholder[];
}

/** Writes a tree to its output through a staging file, so a reader never sees half a project file. */
export class OutputWriter {
	constructor(
		@FileSystemService private readonly fileSystemService: FileSystemService
	) {}

	static textOf(projectFile: RojoProjectFile): string {
		return ProjectText.of(projectFile);
	}

	/** Writes the file when its bytes differ; `force` writes unchanged bytes so a watcher sees them. The missing `placeholders` are created first, whether or not the file is written. */
	async write(
		output: OutputFile,
		tree: RojoProjectFile,
		{ force = false, placeholders = [] }: OutputWriteOptions = {}
	): Promise<Result<boolean, DiagnosticsError>> {
		const projectFile = output.path;
		const content = OutputWriter.textOf(tree);

		const written = await tryWithAsync(async (): Promise<boolean> => {
			await Promise.all(
				placeholders.map((each) => this.createPlaceholder(each))
			);
			const onDisk = (await this.fileSystemService.isFile(projectFile))
				? await this.fileSystemService.readFile(projectFile)
				: undefined;
			if (onDisk === content && !force) return false;
			await replaceFile(
				this.fileSystemService,
				projectFile,
				output.stagingFile(randomUUID()),
				content
			);
			return true;
		});
		if (written.isOk()) return ok(written.value);
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

	private async createPlaceholder({
		path,
		kind,
	}: Placeholder): Promise<void> {
		if ((await placeholderState(this.fileSystemService, path)) !== "absent")
			return;
		if (kind === "folder")
			await this.fileSystemService.createDirectory(path);
		else await this.fileSystemService.writeFile(path, PLACEHOLDER_SOURCE);
	}
}
