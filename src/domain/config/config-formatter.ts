import path from "path";
import { failureReason } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ConfigFileReader } from "../../platform/config/config-file.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { JsoncComments } from "../../base/jsonc-comments.js";
import { ProjectText } from "../rojo/project-text.js";
import { configStructure } from "./config-structure.js";
import { ConfigKeys } from "./config-keys.js";
import { ConfigValidator } from "./config-validator.js";
import { ROGEN_KEYS } from "./config.js";

/** Writes a `default.rogen.json` the way `rojo fmt-project` writes a project file, with Rogen's keys before the `tree`. */
export class ConfigFormatter {
	private readonly reader: ConfigFileReader;

	constructor(private readonly fileSystemService: FileSystemService) {
		this.reader = new ConfigFileReader(fileSystemService, configStructure);
	}

	/** Whether the file changed. A config that `rogen check` refuses fails. The comments stay, each with the entry it was written with; a trailing comma is dropped. */
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

		const parsed = this.reader.parse(text, file);
		if (parsed.isErr()) return err([...parsed.error.diagnostics]);
		const config = parsed.value;
		const keys = ConfigKeys.check(config.model.keys, (key) => ({
			resource: file,
			position: config.positionOfKey(key),
		}));
		if (keys.length > 0) return err(keys);
		const validated = ConfigValidator.validateFile(config);
		if (validated.isErr()) return err(validated.error);
		const contents = config.model.contents;
		const formatted = ProjectText.ofConfig(
			"name" in contents
				? contents
				: { ...contents, name: path.basename(path.dirname(file)) },
			ROGEN_KEYS,
			undefined,
			JsoncComments.of(text)
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
