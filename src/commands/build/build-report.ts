import { ResolvedConfig } from "../../domain/config/config.js";
import {
	Diagnostic,
	diagnosticToJson,
} from "../../platform/diagnostics/diagnostic.js";

export type BuildOutcome = "wrote" | "unchanged" | "notWritten";

/** What a build did to each config, as one JSON document. */
export class BuildReport {
	private readonly configs: Record<string, unknown>[] = [];

	add(
		config: ResolvedConfig,
		outcome: BuildOutcome,
		diagnostics: readonly Diagnostic[]
	): void {
		this.configs.push({
			file: config.file,
			outFile: config.outFile,
			outcome,
			diagnostics: diagnostics.map(diagnosticToJson),
		});
	}

	/** `notBuilding` are the configs here that the run was not asked to build. */
	json(notBuilding: readonly string[]): Record<string, unknown> {
		return { configs: this.configs, notBuilding };
	}
}
