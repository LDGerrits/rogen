export class Registry {
	private static readonly data = new Map<string, unknown>();

	/** @throws Error if `id` is already taken. */
	static add<T>(id: string, data: T): void {
		if (this.data.has(id)) {
			throw new Error(`There is already a registry entry "${id}".`);
		}
		this.data.set(id, data);
	}

	/** @throws Error if nothing was added under `id`. */
	static as<T>(id: string): T {
		if (!this.data.has(id)) {
			throw new Error(`There is no registry entry "${id}".`);
		}
		return this.data.get(id) as T;
	}
}
