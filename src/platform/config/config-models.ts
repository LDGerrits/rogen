import { mergeDeep } from "../../base/object.js";
import { safeStringify } from "../../base/json.js";

/** A section is a dotted path, or its segments when a key may itself contain a dot. */
export type ConfigSection = string | readonly string[];

export function sectionPath(section: ConfigSection): readonly string[] {
	return typeof section === "string" ? section.split(".") : section;
}

export class ConfigModel {
	public readonly keys: string[];

	constructor(public readonly contents: Record<string, unknown> = {}) {
		this.keys = Object.keys(contents);
	}

	getValue<T>(section?: ConfigSection): T | undefined {
		if (!section) return this.contents as T;

		let current: unknown = this.contents;

		for (const component of sectionPath(section)) {
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

export type ConfigSource =
	| { readonly tier: "default" }
	| { readonly tier: "layer"; readonly index: number }
	| { readonly tier: "cli" };

export interface ConfigValue<T> {
	readonly defaultValue?: T;
	readonly layerValues: readonly (T | undefined)[];
	readonly cliValue?: T;
	readonly value?: T;
	/** Which tier supplied `value`, and for a layer which one; `undefined` when nothing sets it. */
	readonly source?: ConfigSource;
}

export class Config {
	private consolidatedModel: ConfigModel | null = null;

	constructor(
		private readonly defaultConfig: ConfigModel,
		private readonly layers: readonly ConfigModel[],
		private readonly cliConfig: ConfigModel
	) {}

	getConsolidatedModel(): ConfigModel {
		if (!this.consolidatedModel) {
			const merged = mergeDeep<Record<string, unknown>>(
				{},
				this.defaultConfig.contents,
				...this.layers.map((layer) => layer.contents),
				this.cliConfig.contents
			);
			this.consolidatedModel = new ConfigModel(merged);
		}
		return this.consolidatedModel;
	}

	getValue<T>(section?: ConfigSection): T {
		return this.getConsolidatedModel().getValue<T>(section) as T;
	}

	inspect<T>(section: ConfigSection): ConfigValue<T> {
		const defaultValue = this.defaultConfig.getValue<T>(section);
		const layerValues = this.layers.map((layer) =>
			layer.getValue<T>(section)
		);
		const cliValue = this.cliConfig.getValue<T>(section);

		return {
			defaultValue,
			layerValues,
			cliValue,
			value: this.getValue<T>(section),
			source: this.sourceOf(defaultValue, layerValues, cliValue),
		};
	}

	getAllKeys(): string[] {
		const keys = new Set<string>([
			...this.defaultConfig.keys,
			...this.layers.flatMap((layer) => layer.keys),
			...this.cliConfig.keys,
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

	private sourceOf(
		defaultValue: unknown,
		layerValues: readonly unknown[],
		cliValue: unknown
	): ConfigSource | undefined {
		if (cliValue !== undefined) return { tier: "cli" };
		for (let index = layerValues.length - 1; index >= 0; index--) {
			if (layerValues[index] !== undefined) {
				return { tier: "layer", index };
			}
		}
		if (defaultValue !== undefined) return { tier: "default" };
		return undefined;
	}
}
