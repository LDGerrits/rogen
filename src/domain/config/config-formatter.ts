import path from "path";
import { failureReason } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ConfigFileReader } from "../../platform/config/config-file.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { hasComments } from "../../base/jsonc.js";
import { ProjectText } from "../rojo/project-text.js";
import { configStructure } from "./config-structure.js";
import { ConfigValidator } from "./config-validator.js";
import { ROGEN_KEYS } from "./config.js";

/** Writes a `default.rogen.json` the way `rojo fmt-project` writes a project file, with Rogen's keys before the `tree`. */
export class ConfigFormatter {
	private readonly reader: ConfigFileReader;

	constructor(private readonly fileSystemService: FileSystemService) {
		this.reader = new ConfigFileReader(fileSystemService, configStructure);
	}

	/** Whether the file changed. A file with comments fails, since the formatted text has none, and so does one with a tree value Rojo can't read; a trailing comma is dropped. */
	async format(file: string): Promise<Result<boolean, Diagnostic[]>> {
		const read = await tryWithAsync(() =>
			this.fileSystemService.readFile(file)
		);
		if (read.isErr())
			return err([
				errorDiagnostic(
					"config.unreadable",
					{ resource: file, position: { line: 1, column: 1 } },
					`the config couldn't be read: ${failureReason(read.error)}.`
				),
			]);
		const text = read.value;
		const name = path.basename(file);

		if (name.endsWith(".jsonc"))
			return err([
				errorDiagnostic(
					"format.commentsLost",
					{ resource: file },
					`${name} may hold comments, and formatting writes none. Rename it to ${name.slice(0, -1)} to format it, or format it in your editor.`
				),
			]);
		const parsed = this.reader.parse(text, file);
		if (parsed.isErr()) return err([...parsed.error.diagnostics]);
		const unreadable = ConfigValidator.unreadableValues(parsed.value);
		if (unreadable.length > 0) return err(unreadable);
		if (hasComments(text))
			return err([
				errorDiagnostic(
					"format.commentsLost",
					{ resource: file },
					`${name} has comments, and formatting writes none. Remove them first, or format it in your editor.`
				),
			]);

		const config = parsed.value.model.contents;
		const formatted = ProjectText.ofConfig(
			"name" in config
				? config
				: { ...config, name: path.basename(path.dirname(file)) },
			ROGEN_KEYS
		);
		if (formatted === text) return ok(false);
		const written = await tryWithAsync(() =>
			this.fileSystemService.writeFile(file, formatted)
		);
		if (written.isErr())
			return err([
				errorDiagnostic(
					"format.writeFailed",
					{ resource: file },
					`the config could not be written: ${failureReason(written.error)}.`
				),
			]);
		return ok(true);
	}
}
