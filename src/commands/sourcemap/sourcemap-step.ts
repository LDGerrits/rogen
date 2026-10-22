import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { ConfigSelection } from "../../domain/config/config-service.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";
import { RojoPlan, RojoStep } from "../build/rojo-step.js";

export interface SourcemapFlags {
	readonly output: string | undefined;
	readonly includeNonScripts: boolean;
	readonly absolute: boolean;
}

/** Rojo's sourcemap of the project the selection names. */
export class SourcemapStep implements RojoStep {
	readonly command = "sourcemap";

	constructor(
		private readonly rojo: RojoCommandService,
		private readonly flags: SourcemapFlags,
		private readonly cwd: string,
		/** Whether the sourcemap may go to the screen, as it does without `-o`. */
		private readonly mayPrint: boolean
	) {}

	plan(selection: ConfigSelection): Result<RojoPlan | undefined, UsageError> {
		if (selection.requireValid().isErr()) return ok(undefined);
		const { output, includeNonScripts, absolute } = this.flags;
		const rojoFlags = [
			...(includeNonScripts ? ["--include-non-scripts"] : []),
			...(absolute ? ["--absolute"] : []),
		];
		if (output === undefined && !this.mayPrint)
			return err(
				new UsageError(
					"Without -o the sourcemap is printed, which leaves no room for --json: give -o <file>."
				)
			);
		return ok({
			project: this.rojo.choose(selection),
			flags:
				output === undefined
					? rojoFlags
					: [...rojoFlags, "--output", output],
			cwd: this.cwd,
			target: { command: this.command, cwd: this.cwd, output },
			...(output === undefined && { printed: true as const }),
		});
	}
}
