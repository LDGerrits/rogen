import { Result } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-project.js";

export interface OutputWriteResult {
	/** Whether the file changed; unchanged bytes are left alone. */
	readonly written: boolean;
}

/** Writes built projects to their `outFile`. */
export interface OutputService {
	readonly _serviceBrand: undefined;

	/** Leaves the file untouched when its bytes wouldn't change, so Rojo doesn't re-sync and `watch` doesn't rebuild on its own write. */
	write(
		config: Pick<ResolvedConfig, "outFile">,
		tree: RojoTree
	): Promise<Result<OutputWriteResult, Diagnostic[]>>;
}

export const OutputService =
	createServiceIdentifier<OutputService>("outputService");
