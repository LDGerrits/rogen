/** The route keys a config declares; a name spells a key exactly or with its first letter flipped. */
export class DeclaredKeys {
	static readonly FALLBACK_ROUTE = "*";

	static readonly NAME = /^[A-Za-z][A-Za-z0-9]*$/;

	readonly routeKeys: ReadonlySet<string>;

	constructor(routeKeys: Iterable<string>) {
		this.routeKeys = new Set(
			[...routeKeys].filter((key) => key !== DeclaredKeys.FALLBACK_ROUTE)
		);
	}

	static isName(text: string): boolean {
		return DeclaredKeys.NAME.test(text);
	}

	/** Keys that share this identity match the same names. */
	static identityOf(key: string): string {
		return key.slice(0, 1).toLowerCase() + key.slice(1);
	}

	static flipFirstLetter(name: string): string {
		const first = name[0];
		const flipped =
			first === first.toLowerCase()
				? first.toUpperCase()
				: first.toLowerCase();
		return flipped + name.slice(1);
	}

	isRoute(key: string): boolean {
		return this.routeKeys.has(key);
	}

	/** The key `name` spells, exactly or with the first letter in the other case. */
	resolve(name: string): string | undefined {
		return this.resolveIn(name, this.routeKeys);
	}

	/** A key that matches `name` ignoring case beyond the first letter, when `name` spells no key. */
	nearMiss(name: string): string | undefined {
		if (this.resolve(name) !== undefined) return undefined;
		const lower = name.toLowerCase();
		return [...this.routeKeys].find((key) => key.toLowerCase() === lower);
	}

	private resolveIn(
		name: string,
		keys: ReadonlySet<string>
	): string | undefined {
		if (name === "") return undefined;
		if (keys.has(name)) return name;
		const flipped = DeclaredKeys.flipFirstLetter(name);
		return keys.has(flipped) ? flipped : undefined;
	}
}
