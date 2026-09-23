import { ServiceIdentifier, ServicesAccessor } from "./instantiation.js";

export class ServiceCollection implements ServicesAccessor {
	private readonly entries = new Map<ServiceIdentifier<unknown>, unknown>();

	set<T>(id: ServiceIdentifier<T>, instance: T): void {
		this.entries.set(id, instance);
	}

	has(id: ServiceIdentifier<unknown>): boolean {
		return this.entries.has(id);
	}

	get<T>(id: ServiceIdentifier<T>): T {
		if (!this.entries.has(id)) {
			throw new Error(`No service registered for "${id.serviceId}".`);
		}
		return this.entries.get(id) as T;
	}
}
