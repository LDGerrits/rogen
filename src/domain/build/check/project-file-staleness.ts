import path from "path";
import { tryWithAsync } from "../../../base/result.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../../platform/fs/file-system-service.js";
import { DEFAULT_PROJECT } from "../../config/config.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { RojoProjectFile } from "../../rojo/rojo-project.js";
import { OutputWriter } from "../output-writer.js";

/** Whether the project file on disk is what a build would write, which a command that writes nothing says by a warning. */
export class ProjectFileStaleness {
	constructor(private readonly fileSystemService: FileReader) {}

	/** The warning for `config`'s project file when it is on disk and differs from `built`; none for a file that isn't there or one Rogen never writes. */
	async diagnostic(
		config: ResolvedConfig,
		built: RojoProjectFile
	): Promise<Diagnostic | undefined> {
		const { projectFile, stem } = config;
		if (config.isAdopted) return undefined;
		const command =
			stem === DEFAULT_PROJECT ? "rogen build" : `rogen build ${stem}`;
		const onDisk = await tryWithAsync(async () =>
			(await this.fileSystemService.isFile(projectFile))
				? await this.fileSystemService.readFile(projectFile)
				: undefined
		);
		if (
			onDisk.isErr() ||
			onDisk.value === undefined ||
			onDisk.value === OutputWriter.textOf(built)
		)
			return undefined;
		return warningDiagnostic(
			"output.differs",
			{ resource: projectFile },
			`this file differs from what 'rogen build' would write: its sources changed since it was written, or it was edited by hand. Run '${command}' to write it again; what it holds comes from ${path.basename(config.file)}, so change that to change it.`,
			[{ run: { command, cwd: path.dirname(config.file) } }]
		);
	}
}
