export class ConfigChangeEvent {
	readonly affectedKeys: ReadonlySet<string>;

	/** `resource` is what the configuration was loaded from, such as a file. */
	constructor(
		changedKeys: string[],
		public readonly resource: string
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
