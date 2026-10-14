import { UsageError } from "../../base/errors.js";
import { Result, ok } from "../../base/result.js";
import { ConfigSelection } from "../../domain/config/config-service.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";

/** Whether Rojo's build has one project to run on, said before anything is written; a selection with broken configs is left to the build to report. */
export function oneProject(
	rojo: RojoCommandService,
	selection: ConfigSelection
): Result<void, UsageError> {
	if (selection.requireValid().isErr()) return ok(undefined);
	const chosen = rojo.choose(selection, "build");
	return chosen.isErr() ? chosen : ok(undefined);
}
