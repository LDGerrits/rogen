export class Registry {
	private static readonly data = new Map<string, unknown>();

	static add<T>(id: string, data: T): void {
		if (this.data.has(id)) {
			throw new Error(`There is already a registry entry "${id}".`);
		}
		this.data.set(id, data);
	}

	static as<T>(id: string): T {
		if (!this.data.has(id)) {
			throw new Error(`There is no registry entry "${id}".`);
		}
		return this.data.get(id) as T;
	}
}
