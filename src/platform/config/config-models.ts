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
			if (!Object.hasOwn(current, component)) return undefined;
			current = (current as Record<string, unknown>)[component];
		}

		return current as T;
	}
}
