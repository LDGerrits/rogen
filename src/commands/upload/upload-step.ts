import { Result, ok } from "../../base/result.js";
import { UsageError } from "../../base/errors.js";
import { ConfigSelection } from "../../domain/config/config-service.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";
import { RojoTarget } from "../write/rojo-entry.js";
import { RojoPlan, RojoStep } from "../write/rojo-step.js";

export class UploadStep implements RojoStep {
	readonly command = "upload";
	readonly prints = false;

	constructor(
		private readonly flags: readonly string[],
		private readonly cwd: string,
		private readonly asset: string,
		@RojoCommandService private readonly rojo: RojoCommandService
	) {}

	get target(): RojoTarget {
		return { command: this.command, cwd: this.cwd, asset: this.asset };
	}

	plan(selection: ConfigSelection): Result<RojoPlan | undefined, UsageError> {
		if (selection.requireValid().isErr()) return ok(undefined);
		return ok({
			project: this.rojo.choose(selection),
			flags: this.flags,
			cwd: this.cwd,
		});
	}
}
