import { ConfigBuild } from "../../domain/build/build-service.js";
import { diagnosticToJson } from "../../platform/diagnostics/diagnostic.js";

type BuildOutcome = "wrote" | "unchanged" | "notWritten";

/** The document only says whether a config was written. */
function outcomeOf(outcome: ConfigBuild["outcome"]): BuildOutcome {
	return outcome === "failed" ? "notWritten" : outcome;
}

/** What a build did to each config, as one JSON document. */
export class BuildReport {
	private readonly configs: Record<string, unknown>[] = [];

	add({
		config,
		outcome,
		warnings,
		syncWarnings,
		errors,
	}: ConfigBuild): void {
		this.configs.push({
			file: config.file,
			outFile: config.outFile,
			outcome: outcomeOf(outcome),
			diagnostics: [...warnings, ...syncWarnings, ...errors].map(
				diagnosticToJson
			),
		});
	}

	/** `notBuilding` are the configs here that the run was not asked to build. */
	json(notBuilding: readonly string[]): Record<string, unknown> {
		return { configs: this.configs, notBuilding };
	}
}
