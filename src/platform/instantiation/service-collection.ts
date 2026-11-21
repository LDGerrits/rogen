import { ServiceIdentifier } from "./instantiation.js";
import { SyncDescriptor } from "./sync-descriptor.js";

export type ServiceEntry<T> = T | SyncDescriptor<T>;

export class ServiceCollection {
	private readonly entries = new Map<
		ServiceIdentifier<unknown>,
		ServiceEntry<unknown>
	>();

	constructor(
		...entries: readonly (readonly [ServiceIdentifier<unknown>, unknown])[]
	) {
		for (const [id, entry] of entries) this.entries.set(id, entry);
	}

	set<T>(
		id: ServiceIdentifier<T>,
		entry: ServiceEntry<T>
	): ServiceEntry<T> | undefined {
		const previous = this.entries.get(id);
		this.entries.set(id, entry);
		return previous as ServiceEntry<T> | undefined;
	}

	has(id: ServiceIdentifier<unknown>): boolean {
		return this.entries.has(id);
	}

	get<T>(id: ServiceIdentifier<T>): ServiceEntry<T> | undefined {
		return this.entries.get(id) as ServiceEntry<T> | undefined;
	}

	ids(): IterableIterator<ServiceIdentifier<unknown>> {
		return this.entries.keys();
	}
}
