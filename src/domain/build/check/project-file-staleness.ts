import path from "path";
import { tryWithAsync } from "../../../base/result.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { RojoProjectFile } from "../../rojo/rojo-project.js";
import { OutputWriter, editedByHandMessage } from "../output-writer.js";
import { HandEdits } from "../hand-edits.js";
import { WrittenRecords } from "../written-records.js";

/** Whether the project file on disk is what a build would write, which a command that writes nothing says by a warning. */
export class ProjectFileStaleness {
	constructor(
		private readonly fileSystemService: FileReader,
		private readonly records: WrittenRecords = new WrittenRecords()
	) {}

	/** The warning for `config`'s project file when it is on disk and differs from what `built` gives: that it is out of date, or that it was edited by hand since Rogen wrote it and a build would lose the edit. None for a file that isn't there, one Rogen never writes, or a build that fails. `built` runs only for a file that is there. */
	async diagnostic(
		config: ResolvedConfig,
		built: () => Promise<RojoProjectFile | undefined>
	): Promise<Diagnostic | undefined> {
		const { projectFile } = config;
		if (config.isAdopted) return undefined;
		const command = "rogen build";
		const onDisk = await tryWithAsync(async () =>
			(await this.fileSystemService.isFile(projectFile))
				? await this.fileSystemService.readFile(projectFile)
				: undefined
		);
		if (onDisk.isErr() || onDisk.value === undefined) return undefined;
		const file = await built();
		if (!file || onDisk.value === OutputWriter.textOf(file))
			return undefined;
		const edited = await HandEdits.editedBy(
			this.records,
			projectFile,
			onDisk.value,
			OutputWriter.textOf(file)
		);
		if (edited)
			return warningDiagnostic(
				"output.editedByHand",
				{ resource: projectFile },
				editedByHandMessage(
					edited,
					path.basename(config.file),
					`'${command}'`
				)
			);
		return warningDiagnostic(
			"output.differs",
			{ resource: projectFile },
			`this file differs from what 'rogen build' would write: its sources changed since it was written. Run '${command}' to write it again; what it holds comes from ${path.basename(config.file)}, so change that to change it.`,
			[{ run: { command, cwd: path.dirname(config.file) } }]
		);
	}
}
