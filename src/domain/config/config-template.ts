import { ErrorUtils } from "../../base/errors.js";
import { isObject } from "../../base/object.js";
import { parse } from "../../base/jsonc.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
} from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ConfigDiagnostics } from "./config-diagnostics.js";
import { ResolvedTemplate } from "./config.js";

/** `location` is where the config named the template, for the diagnostic. */
export async function readTemplate(
	fileSystem: FileSystemService,
	file: string,
	location: DiagnosticLocation
): Promise<Result<ResolvedTemplate, Diagnostic[]>> {
	let text: string;
	try {
		text = await fileSystem.readFile(file);
	} catch (error) {
		return err([
			ConfigDiagnostics.templateUnreadable(
				location,
				ErrorUtils.fromUnknown(error).message
			),
		]);
	}

	const parsed = parse(text);
	if (parsed.isErr()) {
		return err([
			ConfigDiagnostics.templateInvalid(location, parsed.error.message),
		]);
	}
	if (!isObject(parsed.value)) {
		return err([
			ConfigDiagnostics.templateInvalid(
				location,
				"it must be a JSON object."
			),
		]);
	}
	return ok({ file, project: parsed.value });
}
