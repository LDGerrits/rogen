import { mergeDeep } from "../../base/object.js";
import { safeStringify } from "../../base/json.js";

export class ConfigModel {
	public readonly keys: string[];

	constructor(public readonly contents: Record<string, unknown> = {}) {
		this.keys = Object.keys(contents);
	}

	getValue<T>(section?: string): T | undefined {
		if (!section) return this.contents as T;

		const path = section.split(".");
		let current: unknown = this.contents;

		for (const component of path) {
			if (typeof current !== "object" || current === null)
				return undefined;
			current = (current as Record<string, unknown>)[component];
		}

		return current as T;
	}

	isEmpty(): boolean {
		return this.keys.length === 0;
	}
}

export interface ConfigValue<T> {
	readonly defaultValue?: T;
	readonly projectValue?: T;
	readonly cliValue?: T;
	readonly memoryValue?: T;
	readonly value?: T;
}

export class Config {
	private consolidatedModel: ConfigModel | null = null;

	constructor(
		private readonly defaultConfig: ConfigModel,
		private readonly projectConfig: ConfigModel,
		private readonly cliConfig: ConfigModel,
		private readonly memoryConfig: ConfigModel
	) {}

	getConsolidatedModel(): ConfigModel {
		if (!this.consolidatedModel) {
			const merged = mergeDeep<Record<string, unknown>>(
				{},
				this.defaultConfig.contents,
				this.projectConfig.contents,
				this.cliConfig.contents,
				this.memoryConfig.contents
			);
			this.consolidatedModel = new ConfigModel(merged);
		}
		return this.consolidatedModel;
	}

	getValue<T>(section?: string): T {
		return this.getConsolidatedModel().getValue<T>(section) as T;
	}

	inspect<T>(section: string): ConfigValue<T> {
		const defaultValue = this.defaultConfig.getValue<T>(section);
		const projectValue = this.projectConfig.getValue<T>(section);
		const cliValue = this.cliConfig.getValue<T>(section);
		const memoryValue = this.memoryConfig.getValue<T>(section);

		return {
			defaultValue,
			projectValue,
			cliValue,
			memoryValue,
			value: this.getValue<T>(section),
		};
	}

	getAllKeys(): string[] {
		const keys = new Set<string>([
			...this.defaultConfig.keys,
			...this.projectConfig.keys,
			...this.cliConfig.keys,
			...this.memoryConfig.keys,
		]);
		return Array.from(keys);
	}

	compare(other: Config): string[] {
		const changedKeys: string[] = [];
		const allKeys = new Set([...this.getAllKeys(), ...other.getAllKeys()]);

		for (const key of allKeys) {
			const thisValue = this.getValue(key);
			const otherValue = other.getValue(key);

			if (safeStringify(thisValue) !== safeStringify(otherValue)) {
				changedKeys.push(key);
			}
		}

		return changedKeys;
	}
}
