export class DeclaredKeys {
	static readonly FALLBACK_ROUTE = "*";

	static readonly NAME = /^[A-Za-z][A-Za-z0-9]*$/;

	readonly routeKeys: ReadonlySet<string>;

	constructor(routeKeys: Iterable<string>) {
		this.routeKeys = new Set([...routeKeys].filter(DeclaredKeys.isName));
	}

	static isName(text: string): boolean {
		return DeclaredKeys.NAME.test(text);
	}

	static identityOf(key: string): string {
		return key.toLowerCase();
	}

	isRoute(key: string): boolean {
		return this.routeKeys.has(key);
	}

	resolve(name: string): string | undefined {
		return this.routeKeys.has(name) ? name : undefined;
	}

	/**
	 * The key a script suffix Rojo reads only in lower case (`.server`) names,
	 * in any letter case.
	 */
	resolveDotRoute(part: string): string | undefined {
		return [...this.routeKeys].find(
			(key) => DeclaredKeys.identityOf(key) === part
		);
	}

	isFree(name: string): boolean {
		return (
			DeclaredKeys.isName(name) &&
			!this.isRoute(name) &&
			this.nearMiss(name) === undefined
		);
	}

	nearMiss(name: string): string | undefined {
		if (this.resolve(name) !== undefined) return undefined;
		const identity = DeclaredKeys.identityOf(name);
		return [...this.routeKeys].find(
			(key) => DeclaredKeys.identityOf(key) === identity
		);
	}
}
