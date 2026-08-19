import { Event } from "../../base/event.js";
import { ConfigValue } from "./config-models.js";

export const enum ConfigTarget {
	DEFAULT = 1,
	PROJECT,
	CLI,
	MEMORY,
}

export class ConfigChangeEvent {
	readonly affectedKeys: ReadonlySet<string>;

	constructor(
		changedKeys: string[],
		public readonly source: ConfigTarget
	) {
		this.affectedKeys = new Set(changedKeys);
	}

	affectsConfig(section: string): boolean {
		for (const key of this.affectedKeys) {
			if (
				key === section ||
				key.startsWith(`${section}.`) ||
				section.startsWith(`${key}.`)
			) {
				return true;
			}
		}
		return false;
	}
}

export interface ConfigService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeConfig: Event<ConfigChangeEvent>;

	getValue<T>(section?: string): T;

	/**
	 * Inspects a value to determine exactly which layer provided it.
	 */
	inspect<T>(section: string): ConfigValue<T>;

	/**
	 * Reloads the config file and recalculates the merged model.
	 */
	reloadConfig(): Promise<void>;
}
