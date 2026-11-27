import { failureReason } from "../../base/errors.js";
import { randomUUID } from "crypto";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileReplacer } from "../../platform/fs/file-replacer.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
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

export class OutputWriter {
	private readonly replacer: FileReplacer;

	constructor(
		@FileSystemService private readonly fileSystemService: FileSystemService
	) {
		this.replacer = new FileReplacer(fileSystemService);
	}

	static textOf(projectFile: RojoProjectFile): string {
		return ProjectText.of(projectFile);
	}

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
			await this.replacer.replace(
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
