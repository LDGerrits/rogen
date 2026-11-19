/** The route keys a config declares; a name spells a key exactly as it is declared. */
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

	/** Keys that share this identity differ in letter case alone. */
	static identityOf(key: string): string {
		return key.toLowerCase();
	}

	isRoute(key: string): boolean {
		return this.routeKeys.has(key);
	}

	/** The key `name` spells exactly. */
	resolve(name: string): string | undefined {
		return this.routeKeys.has(name) ? name : undefined;
	}

	/** The key a script suffix Rojo reads only in lower case (`.server`) names, in any letter case. */
	resolveDotRoute(part: string): string | undefined {
		return [...this.routeKeys].find(
			(key) => DeclaredKeys.identityOf(key) === part
		);
	}

	/** A key that matches `name` ignoring letter case, when `name` spells no key. */
	nearMiss(name: string): string | undefined {
		if (this.resolve(name) !== undefined) return undefined;
		const identity = DeclaredKeys.identityOf(name);
		return [...this.routeKeys].find(
			(key) => DeclaredKeys.identityOf(key) === identity
		);
	}
}
