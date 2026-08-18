export class Registry {
	private static readonly data = new Map<string, unknown>();

	static add<T>(id: string, data: T): void {
		this.data.set(id, data);
	}

	static as<T>(id: string): T {
		return this.data.get(id) as T;
	}
}
