export interface ServiceIdentifier<T> {
	(target: object, key: string | symbol | undefined, index: number): void;
	readonly serviceId: string;
	readonly _type: T;
}

export interface ServicesAccessor {
	get<T>(id: ServiceIdentifier<T>): T;
}

export interface BrandedService {
	readonly _serviceBrand: undefined;
}

interface ServiceDependency {
	readonly id: ServiceIdentifier<unknown>;
	readonly index: number;
}

const dependenciesOf = new WeakMap<object, ServiceDependency[]>();
const serviceIds = new Map<string, ServiceIdentifier<unknown>>();

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
