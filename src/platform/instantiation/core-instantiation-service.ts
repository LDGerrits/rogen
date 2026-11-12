import { Disposable } from "../../base/disposable.js";
import { InstantiationService } from "./instantiation-service.js";
import {
	ServiceIdentifier,
	ServicesAccessor,
	getServiceDependencies,
} from "./instantiation.js";
import { ServiceCollection } from "./service-collection.js";
import { SyncDescriptor } from "./sync-descriptor.js";

export class CoreInstantiationService
	implements InstantiationService, Disposable
{
	declare readonly _serviceBrand: undefined;

	private readonly services: ServiceCollection;
	private readonly building: ServiceIdentifier<unknown>[] = [];
	private readonly built: unknown[] = [];

	constructor(services: ServiceCollection = new ServiceCollection()) {
		this.services = services;
		services.set(InstantiationService, this);
	}

	createInstance<
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		Ctor extends new (...args: any[]) => unknown,
		R extends InstanceType<Ctor>,
	>(ctor: Ctor, ...args: unknown[]): R {
		return this.construct(ctor, args) as R;
	}

	invokeFunction<R, Args extends unknown[] = []>(
		fn: (accessor: ServicesAccessor, ...args: Args) => R,
		...args: Args
	): R {
		const accessor: ServicesAccessor = {
			get: (id) => this.getOrCreate(id),
		};
		return fn(accessor, ...args);
	}

	/** Disposes the services this one built from descriptors, the last first, and keeps going when one fails; what `createInstance` returned belongs to its caller. */
	[Symbol.dispose](): void {
		const failures: unknown[] = [];
		for (const service of this.built.reverse()) {
			try {
				if (isDisposable(service)) service[Symbol.dispose]();
			} catch (error) {
				failures.push(error);
			}
		}
		this.built.length = 0;
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1)
			throw new AggregateError(
				failures,
				"Several services failed to dispose."
			);
	}

	private getOrCreate<T>(id: ServiceIdentifier<T>): T {
		const entry = this.services.get(id);
		if (!(entry instanceof SyncDescriptor)) return entry;
		if (this.building.includes(id)) {
			throw new Error(
				`Services depend on each other in a circle: ${[...this.building, id].map((each) => each.serviceId).join(" -> ")}.`
			);
		}
		this.building.push(id);
		try {
			const instance = this.construct(entry.ctor, [
				...entry.staticArguments,
			]) as T;
			this.services.set(id, instance);
			this.built.push(instance);
			return instance;
		} finally {
			this.building.pop();
		}
	}

	private construct(
		ctor: new (...args: never[]) => unknown,
		staticArguments: unknown[]
	): unknown {
		const dependencies = getServiceDependencies(ctor);
		const firstService = dependencies[0]?.index ?? staticArguments.length;
		if (staticArguments.length > firstService) {
			throw new Error(
				`${ctor.name} takes ${firstService} argument(s) before its services, and was given ${staticArguments.length}.`
			);
		}
		while (staticArguments.length < firstService) {
			staticArguments.push(undefined);
		}
		const args = [
			...staticArguments,
			...dependencies.map(({ id }) => this.getOrCreate(id)),
		];
		return new ctor(...(args as never[]));
	}
}

function isDisposable(value: unknown): value is Disposable {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Disposable)[Symbol.dispose] === "function"
	);
}
