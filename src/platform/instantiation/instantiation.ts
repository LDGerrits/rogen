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

export function createDecorator<T>(serviceId: string): ServiceIdentifier<T> {
	const decorator = function (
		target: object,
		_key: string | symbol | undefined,
		index: number
	): void {
		const known = dependenciesOf.get(target);
		const dependency = {
			id: decorator as ServiceIdentifier<unknown>,
			index,
		};
		if (known) known.push(dependency);
		else dependenciesOf.set(target, [dependency]);
	} as ServiceIdentifier<T>;
	Object.defineProperty(decorator, "serviceId", { value: serviceId });
	decorator.toString = () => serviceId;
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
