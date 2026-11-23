import path from "path";
import { tryWithAsync } from "../../../base/result.js";
import { commandWith } from "../../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { ConfigService } from "../../config/config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { RojoProjectFile } from "../../rojo/rojo-project.js";
import { OutputWriter } from "../output-writer.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";

export class ProjectFileStaleness {
	constructor(
		@FileSystemService
		private readonly fileSystemService: FileSystemService,
		@ConfigService private readonly configService: ConfigService
	) {}

	async diagnostic(
		config: ResolvedConfig,
		expected: () => Promise<RojoProjectFile | undefined>,
		outputFile = config.projectFile
	): Promise<Diagnostic | undefined> {
		if (config.isAdopted) return undefined;
		const command = commandWith(
			"rogen write",
			await this.configService.referenceTo(
				config.file,
				path.dirname(config.file)
			)
		);
		const onDisk = await tryWithAsync(async () =>
			(await this.fileSystemService.isFile(outputFile))
				? await this.fileSystemService.readFile(outputFile)
				: undefined
		);
		if (onDisk.isErr() || onDisk.value === undefined) return undefined;
		const file = await expected();
		if (!file || onDisk.value === OutputWriter.textOf(file))
			return undefined;
		return warningDiagnostic(
			"output.differs",
			{ resource: outputFile },
			`this file is out of date: its sources changed. Run '${command}'; to change it, edit ${path.basename(config.file)}.`,
			[{ run: { command, cwd: path.dirname(config.file) } }]
		);
	}

	async leftover(config: ResolvedConfig): Promise<Diagnostic | undefined> {
		const outputFile = config.leftoverCompilerFile;
		if (
			outputFile === undefined ||
			!(await this.fileSystemService.isFile(outputFile))
		)
			return undefined;
		const command = commandWith(
			"rogen write",
			await this.configService.referenceTo(
				config.file,
				path.dirname(config.file)
			)
		);
		return warningDiagnostic(
			"output.differs",
			{ resource: outputFile },
			`this file is out of date: ${path.basename(config.file)} no longer writes it. Run '${command}' to remove it.`,
			[{ run: { command, cwd: path.dirname(config.file) } }]
		);
	}
}
