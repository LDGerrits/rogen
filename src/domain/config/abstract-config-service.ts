import { AbstractDisposable } from "../../base/disposable.js";
import { Result, err, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ConfigEntry, ResolvedEntry } from "./config-service.js";

/** The questions every config service answers from its `configs`. */
export abstract class AbstractConfigService extends AbstractDisposable {
	abstract readonly configs: readonly ConfigEntry[];

	getConfig(file: string): ConfigEntry | undefined {
		return this.configs.find((entry) => entry.file === file);
	}

	getResolvedEntries(): ResolvedEntry[] {
		return this.configs.flatMap((entry) =>
			entry.resolved ? [{ entry, config: entry.resolved }] : []
		);
	}

	requireValidEntries(): Result<ResolvedEntry[], DiagnosticsError> {
		const errors = this.configs.flatMap((entry) => entry.errors);
		return errors.length > 0
			? err(new DiagnosticsError(errors))
			: ok(this.getResolvedEntries());
	}

	getBrokenError(): Error | undefined {
		const broken = this.configs.filter((entry) => entry.isBroken);
		return broken.length > 0
			? new Error(
					`${broken.length} of ${this.configs.length} configs have errors.`
				)
			: undefined;
	}
}
