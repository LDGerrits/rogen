import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { planPlace, readBaseConfig } from "./init-place.js";
import { InitPlan, planInit } from "./init-plan.js";
import { InitAnswers, InitContext } from "./init-questions.js";

/** A place is planned from the resolved `default.rogen.json`, which is read here. */
export async function planAnswers(
	fileSystem: FileSystemService,
	context: InitContext,
	answers: InitAnswers,
	projectName: string
): Promise<Result<InitPlan, Diagnostic[]>> {
	const { workspace, directory, existingFiles } = context;
	if (answers.kind === "project") {
		return planInit({
			choices: answers.choices,
			projectName,
			directory,
			existingFiles,
		});
	}

	const base = await readBaseConfig(fileSystem, directory);
	if (base.isErr()) return base;
	return planPlace({
		choices: answers.choices,
		base: base.value,
		workspace,
		directory,
		existingFiles,
	});
}
