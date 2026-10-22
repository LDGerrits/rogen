import path from "path";
import { failureReason } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { JsoncDocumentReader } from "../../platform/jsonc/jsonc-document-reader.js";
import { ProjectText } from "../rojo/project-text.js";
import { configStructure } from "./config-structure.js";
import { ROGEN_KEYS } from "./config.js";

/** Writes a `default.rogen.json` the way `rojo fmt-project` writes a project file, and Rogen's keys after Rojo's. */
export class ConfigFormatter {
	private readonly documents = new JsoncDocumentReader({
		codePrefix: "config",
		noun: "a config",
	});

	constructor(private readonly fileSystemService: FileSystemService) {}

	/** Whether the file changed. A file with comments is left as it is, since the formatted text has none. */
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
		const document = this.documents.read(text, file, configStructure);
		if (document.isErr()) return err(document.error);
		if (!ConfigFormatter.isStrict(text))
			return err([
				errorDiagnostic(
					"format.commentsLost",
					{ resource: file },
					`${name} has comments or trailing commas, and formatting writes none. Remove them first, or format it in your editor.`
				),
			]);

		const config = document.value.value;
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

	private static isStrict(text: string): boolean {
		try {
			JSON.parse(text.replace(/^\uFEFF/, ""));
			return true;
		} catch {
			return false;
		}
	}
}
