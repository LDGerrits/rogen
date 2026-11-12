/** A service identifier is also the parameter decorator that asks for the service: `@LogService private readonly logService: LogService`. */
export interface ServiceIdentifier<T> {
	(target: object, key: string | symbol | undefined, index: number): void;
	readonly serviceId: string;
	readonly _type: T;
}

export interface ServicesAccessor {
	/** @throws Error if no service is registered for `id`, or the accessor is used after the function it was passed to returned. */
	get<T>(id: ServiceIdentifier<T>): T;
}

/** Every service interface carries this, so `createInstance` can tell its injected parameters from the ones the caller passes. */
export interface BrandedService {
	readonly _serviceBrand: undefined;
}

interface ServiceDependency {
	readonly id: ServiceIdentifier<unknown>;
	readonly index: number;
}

const dependenciesOf = new WeakMap<object, ServiceDependency[]>();
const serviceIds = new Map<string, ServiceIdentifier<unknown>>();

/** One identifier per name, so two modules that ask for the same name get the same service. */
export function createDecorator<T>(serviceId: string): ServiceIdentifier<T> {
	const known = serviceIds.get(serviceId);
	if (known) return known as ServiceIdentifier<T>;
	const decorator = function (
		target: object,
		_key: string | symbol | undefined,
		index: number
	): void {
		const dependency = {
			id: decorator as ServiceIdentifier<unknown>,
			index,
		};
		const dependencies = dependenciesOf.get(target);
		if (dependencies) dependencies.push(dependency);
		else dependenciesOf.set(target, [dependency]);
	} as ServiceIdentifier<T>;
	Object.defineProperty(decorator, "serviceId", { value: serviceId });
	decorator.toString = () => serviceId;
	serviceIds.set(serviceId, decorator as ServiceIdentifier<unknown>);
	return decorator;
}

/** The services a class asks for, by parameter position; a subclass without a constructor of its own asks for its base class's. */
export function getServiceDependencies(
	ctor: object
): readonly ServiceDependency[] {
	for (
		let current: object | null = ctor;
		current && current !== Function.prototype;
		current = Object.getPrototypeOf(current) as object | null
	) {
		const dependencies = dependenciesOf.get(current);
		if (dependencies) {
			return [...dependencies].sort((a, b) => a.index - b.index);
		}
	}
	return [];
}
