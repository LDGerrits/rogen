export interface ServiceIdentifier<T> {
	readonly serviceId: string;
	readonly _type: T;
}

export function createServiceIdentifier<T>(
	serviceId: string
): ServiceIdentifier<T> {
	return { serviceId, toString: () => serviceId } as ServiceIdentifier<T>;
}

export interface ServicesAccessor {
	/** @throws Error if no instance is registered for `id`. */
	get<T>(id: ServiceIdentifier<T>): T;
}
