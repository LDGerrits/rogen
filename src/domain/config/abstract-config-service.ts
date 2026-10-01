import { AbstractDisposable } from "../../base/disposable.js";
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

	getBrokenError(): Error | undefined {
		const broken = this.configs.filter((entry) => entry.isBroken);
		return broken.length > 0
			? new Error(
					`${broken.length} of ${this.configs.length} configs have errors.`
				)
			: undefined;
	}
}
