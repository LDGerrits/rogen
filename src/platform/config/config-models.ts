import { mergeDeep } from "../../base/objects.js";
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
}

export type ConfigSource =
	| { readonly tier: "default" }
	| { readonly tier: "layer"; readonly index: number }
	| { readonly tier: "cli" };

/** How a field combines across tiers: `merge` maps by key and scalars by replacing, `replace` takes the last tier whole, `append` adds each tier's list entries to the earlier ones. */
export type MergePolicy = "merge" | "replace" | "append";

/** The policy of each top-level key; a key without one merges. */
export type MergePolicies = Readonly<Record<string, MergePolicy>>;

/** One entry of a list that tiers add to, with where it was written. */
export interface ConfigEntry<T> {
	readonly value: T;
	readonly source: ConfigSource;
	/** Its position in the list of the tier that wrote it. */
	readonly index: number;
}

export interface ConfigValue<T> {
	readonly defaultValue?: T;
	readonly layerValues: readonly (T | undefined)[];
	readonly cliValue?: T;
	readonly value?: T;
	/** Which tier supplied `value`, and for a layer which one; `undefined` when nothing sets it. */
	readonly source?: ConfigSource;
}

function asList<T>(value: unknown): T[] | undefined {
	return Array.isArray(value) ? (value as T[]) : undefined;
}

export class Config {
	private consolidatedModel: ConfigModel | null = null;

	constructor(
		private readonly defaultConfig: ConfigModel,
		private readonly layers: readonly ConfigModel[],
		private readonly cliConfig: ConfigModel,
		private readonly policies: MergePolicies = {}
	) {}

	getConsolidatedModel(): ConfigModel {
		if (!this.consolidatedModel) {
			const merged = mergeDeep<Record<string, unknown>>(
				{},
				this.defaultConfig.contents,
				...this.layers.map((layer) => layer.contents),
				this.cliConfig.contents
			);
			for (const key of Object.keys(merged)) {
				const policy = this.policies[key];
				if (policy === "append") {
					merged[key] = this.entries<unknown>([key]).map(
						({ value }) => value
					);
				} else if (policy === "replace") {
					merged[key] = this.lastValue(key);
				}
			}
			this.consolidatedModel = new ConfigModel(merged);
		}
		return this.consolidatedModel;
	}

	/**
	 * The entries of the list at `section`, each tier's after the earlier ones.
	 * An entry a later tier repeats moves to the later position. The default
	 * applies only when no layer or the command line sets the list.
	 */
	entries<T>(section: ConfigSection): ConfigEntry<T>[] {
		const tiers: { source: ConfigSource; list: T[] | undefined }[] = [
			...this.layers.map((layer, index) => ({
				source: { tier: "layer", index } as const,
				list: asList<T>(layer.getValue(section)),
			})),
			{
				source: { tier: "cli" },
				list: asList<T>(this.cliConfig.getValue(section)),
			},
		];
		if (tiers.every(({ list }) => list === undefined)) {
			tiers.unshift({
				source: { tier: "default" },
				list: asList<T>(this.defaultConfig.getValue(section)),
			});
		}

		let result: ConfigEntry<T>[] = [];
		for (const { source, list } of tiers) {
			if (!list) continue;
			result = result.filter(({ value }) => !list.includes(value));
			list.forEach((value, index) =>
				result.push({ value, source, index })
			);
		}
		return result;
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

	/** Whether every key resolves to the same value in both. */
	equals(other: Config): boolean {
		const keys = new Set([...this.keys(), ...other.keys()]);
		for (const key of keys) {
			if (
				safeStringify(this.getValue(key)) !==
				safeStringify(other.getValue(key))
			) {
				return false;
			}
		}
		return true;
	}

	private lastValue(key: string): unknown {
		const tiers = [
			this.defaultConfig,
			...this.layers,
			this.cliConfig,
		].filter((tier) => tier.getValue(key) !== undefined);
		return tiers[tiers.length - 1]?.getValue(key);
	}

	private keys(): string[] {
		return [
			...this.defaultConfig.keys,
			...this.layers.flatMap((layer) => layer.keys),
			...this.cliConfig.keys,
		];
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
