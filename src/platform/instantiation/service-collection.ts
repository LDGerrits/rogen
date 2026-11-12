import { ServiceIdentifier } from "./instantiation.js";
import { SyncDescriptor } from "./sync-descriptor.js";

/** What a collection holds for a service: the instance, or the descriptor that says how to build it. */
type ServiceEntry<T> = T | SyncDescriptor<T>;

export class ServiceCollection {
	private readonly entries = new Map<
		ServiceIdentifier<unknown>,
		ServiceEntry<unknown>
	>();

	set<T>(id: ServiceIdentifier<T>, entry: ServiceEntry<T>): void {
		this.entries.set(id, entry);
	}

	has(id: ServiceIdentifier<unknown>): boolean {
		return this.entries.has(id);
	}

	/** @throws Error if nothing is registered for `id`. */
	get<T>(id: ServiceIdentifier<T>): ServiceEntry<T> {
		if (!this.entries.has(id)) {
			throw new Error(`No service registered for "${id.serviceId}".`);
		}
		return this.entries.get(id) as ServiceEntry<T>;
	}
}
