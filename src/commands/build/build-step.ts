import { Result, ok } from "../../base/result.js";
import { UsageError } from "../../base/errors.js";
import { ConfigSelection } from "../../domain/config/config-service.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";
import { RojoPlan, RojoStep } from "./rojo-step.js";

/** Rojo's build into the place, model or plugin `-o` or `-p` names. */
export class BuildStep implements RojoStep {
	readonly command = "build";

	constructor(
		private readonly rojo: RojoCommandService,
		/** Rojo's flags for the build. */
		private readonly flags: readonly string[],
		private readonly cwd: string,
		private readonly output: string | undefined,
		private readonly plugin: string | undefined
	) {}

	plan(selection: ConfigSelection): Result<RojoPlan | undefined, UsageError> {
		if (selection.requireValid().isErr()) return ok(undefined);
		return ok({
			project: this.rojo.choose(selection),
			flags: this.flags,
			cwd: this.cwd,
			target: {
				command: this.command,
				cwd: this.cwd,
				output: this.output,
				plugin: this.plugin,
			},
		});
	}
}
