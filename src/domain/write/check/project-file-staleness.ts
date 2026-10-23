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

/** Whether the project file on disk is what a write would write, which a command that writes nothing says by a warning. */
export class ProjectFileStaleness {
	constructor(private readonly fileSystemService: FileReader) {}

	/** The warning for `config`'s project file when it is on disk and differs from what `expected` gives: that it is out of date. None for a file that isn't there, one Rogen never writes, or a write that fails. `expected` runs only for a file that is there. */
	async diagnostic(
		config: ResolvedConfig,
		expected: () => Promise<RojoProjectFile | undefined>
	): Promise<Diagnostic | undefined> {
		const { projectFile } = config;
		if (config.isAdopted) return undefined;
		const configName = path.basename(config.file);
		const command = configName.startsWith(`${DEFAULT_PROJECT}.`)
			? "rogen write"
			: `rogen write ${configName}`;
		const onDisk = await tryWithAsync(async () =>
			(await this.fileSystemService.isFile(projectFile))
				? await this.fileSystemService.readFile(projectFile)
				: undefined
		);
		if (onDisk.isErr() || onDisk.value === undefined) return undefined;
		const file = await expected();
		if (!file || onDisk.value === OutputWriter.textOf(file))
			return undefined;
		return warningDiagnostic(
			"output.differs",
			{ resource: projectFile },
			`this file differs from what '${command}' would write: its sources changed since it was written. Run '${command}' to write it again; what it holds comes from ${configName}, so change that to change it.`,
			[{ run: { command, cwd: path.dirname(config.file) } }]
		);
	}
}
