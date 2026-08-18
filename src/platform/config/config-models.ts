import { mergeDeep } from "../../base/object.js";

export class ConfigurationModel {
	constructor(public readonly contents: Record<string, unknown> = {}) {}

	/**
	 * Deep merges this model with another model, returning a new instance.
	 * The `other` model takes precedence.
	 */
	merge(other: ConfigurationModel): ConfigurationModel {
		const mergedContents = mergeDeep<Record<string, unknown>>(
			{},
			this.contents,
			other.contents
		);
		return new ConfigurationModel(mergedContents);
	}

	/**
	 * Retrieves a value at the given path.
	 */
	getValue<T>(section?: string): T {
		if (!section) {
			return this.contents as T;
		}

		const path = section.split(".");
		let current: unknown = this.contents;

		for (const component of path) {
			if (typeof current !== "object" || current === null) {
				return undefined as unknown as T;
			}
			current = (current as Record<string, unknown>)[component];
		}

		return current as T;
	}

	isEmpty(): boolean {
		return Object.keys(this.contents).length === 0;
	}
}
