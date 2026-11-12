import { Disposable, DisposableStore } from "../../base/disposable.js";
import { Graph } from "../../base/graph.js";
import {
	InstantiationService,
	LeadingNonServiceArgs,
} from "./instantiation-service.js";
import {
	ServiceIdentifier,
	ServicesAccessor,
	getServiceDependencies,
} from "./instantiation.js";
import { ServiceCollection } from "./service-collection.js";
import { SyncDescriptor } from "./sync-descriptor.js";

type Ctor = new (...args: never[]) => unknown;

interface Pending {
	readonly id: ServiceIdentifier<unknown>;
	readonly desc: SyncDescriptor<unknown>;
}

class CyclicDependencyError extends Error {
	constructor(graph: Graph<Pending>) {
		super("cyclic dependency between services");
		this.message =
			graph.findCycleSlow() ??
			`UNABLE to detect cycle, dumping graph: \n${graph.toString()}`;
	}
}

/** Builds services from descriptors the first time they are asked for, with their dependencies first, as VS Code's `InstantiationService` does. Without VS Code's tracing, and without its delayed services, which a short run has no use for. */
export class CoreInstantiationService
	implements InstantiationService, Disposable
{
	declare readonly _serviceBrand: undefined;

	private readonly services: ServiceCollection;
	private readonly strict: boolean;
	private readonly parent: CoreInstantiationService | undefined;
	private readonly children = new Set<CoreInstantiationService>();
	private readonly servicesToMaybeDispose = new Set<unknown>();
	private readonly activeInstantiations = new Set<
		ServiceIdentifier<unknown>
	>();
	private isDisposed = false;

	/** With `strict`, a service nobody registered throws instead of arriving as `undefined`. */
	constructor(
		services: ServiceCollection = new ServiceCollection(),
		strict = false,
		parent?: CoreInstantiationService
	) {
		this.services = services;
		this.strict = strict;
		this.parent = parent;
		this.services.set(InstantiationService, this);
	}

	createChild(
		services: ServiceCollection,
		store?: DisposableStore
	): InstantiationService {
		this.throwIfDisposed();
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const that = this;
		const child: CoreInstantiationService =
			new (class extends CoreInstantiationService {
				override [Symbol.dispose](): void {
					that.children.delete(child);
					super[Symbol.dispose]();
				}
			})(services, this.strict, this);
		this.children.add(child);
		store?.add(child);
		return child;
	}

	createInstance<
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		C extends new (...args: any[]) => unknown,
		R extends InstanceType<C>,
	>(ctor: C, ...args: LeadingNonServiceArgs<ConstructorParameters<C>>): R;
	createInstance<T>(descriptor: SyncDescriptor<T>, ...args: unknown[]): T;
	createInstance(
		ctorOrDescriptor: Ctor | SyncDescriptor<unknown>,
		...rest: unknown[]
	): unknown {
		this.throwIfDisposed();
		return ctorOrDescriptor instanceof SyncDescriptor
			? this.construct(ctorOrDescriptor.ctor, [
					...ctorOrDescriptor.staticArguments,
					...rest,
				])
			: this.construct(ctorOrDescriptor, rest);
	}

	invokeFunction<R, Args extends unknown[] = []>(
		fn: (accessor: ServicesAccessor, ...args: Args) => R,
		...args: Args
	): R {
		this.throwIfDisposed();
		let done = false;
		try {
			const accessor: ServicesAccessor = {
				get: <T>(id: ServiceIdentifier<T>): T => {
					if (done) {
						throw new Error(
							"service accessor is only valid during the invocation of its target method"
						);
					}
					const result = this.getOrCreateServiceInstance(id);
					if (!result) {
						throw new Error(
							`[invokeFunction] unknown service '${id}'`
						);
					}
					return result;
				},
			};
			return fn(accessor, ...args);
		} finally {
			done = true;
		}
	}

	/** Disposes the children, then the services built from descriptors, in the order they were built; what `createInstance` returned belongs to its caller. */
	[Symbol.dispose](): void {
		if (this.isDisposed) return;
		this.isDisposed = true;
		const failures: unknown[] = [];
		const attempt = (dispose: () => void) => {
			try {
				dispose();
			} catch (error) {
				failures.push(error);
			}
		};
		for (const child of [...this.children]) {
			attempt(() => child[Symbol.dispose]());
		}
		this.children.clear();
		for (const candidate of this.servicesToMaybeDispose) {
			if (isDisposable(candidate)) {
				attempt(() => candidate[Symbol.dispose]());
			}
		}
		this.servicesToMaybeDispose.clear();
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(
				failures,
				"Several services failed to dispose."
			);
		}
	}

	private throwIfDisposed(): void {
		if (this.isDisposed)
			throw new Error("InstantiationService has been disposed");
	}

	private throwIfStrict(message: string): void {
		if (this.strict) throw new Error(message);
	}

	private construct(ctor: Ctor, staticArguments: unknown[]): unknown {
		const dependencies = getServiceDependencies(ctor);
		const serviceArgs: unknown[] = [];
		for (const dependency of dependencies) {
			const service = this.getOrCreateServiceInstance(dependency.id);
			if (!service) {
				this.throwIfStrict(
					`[createInstance] ${ctor.name} depends on UNKNOWN service ${dependency.id}.`
				);
			}
			serviceArgs.push(service);
		}
		const firstService = dependencies[0]?.index ?? staticArguments.length;
		if (staticArguments.length > firstService) {
			throw new Error(
				`${ctor.name} takes ${firstService} argument(s) before its services, and was given ${staticArguments.length}.`
			);
		}
		// An argument left out is undefined, so the default of its parameter applies.
		const args = [...staticArguments];
		while (args.length < firstService) args.push(undefined);
		return Reflect.construct(ctor, [...args, ...serviceArgs]);
	}

	private getServiceInstanceOrDescriptor(
		id: ServiceIdentifier<unknown>
	): unknown {
		const entry = this.services.get(id);
		if (!entry && this.parent) {
			return this.parent.getServiceInstanceOrDescriptor(id);
		}
		return entry;
	}

	private setCreatedServiceInstance(
		id: ServiceIdentifier<unknown>,
		instance: unknown
	): void {
		if (this.services.get(id) instanceof SyncDescriptor) {
			this.services.set(id, instance);
		} else if (this.parent) {
			this.parent.setCreatedServiceInstance(id, instance);
		} else {
			throw new Error("illegal state - setting UNKNOWN service instance");
		}
	}

	private getOrCreateServiceInstance<T>(id: ServiceIdentifier<T>): T {
		const thing = this.getServiceInstanceOrDescriptor(id);
		return thing instanceof SyncDescriptor
			? (this.safeCreateAndCacheServiceInstance(id, thing) as T)
			: (thing as T);
	}

	private safeCreateAndCacheServiceInstance(
		id: ServiceIdentifier<unknown>,
		desc: SyncDescriptor<unknown>
	): unknown {
		if (this.activeInstantiations.has(id)) {
			throw new Error(
				`illegal state - RECURSIVELY instantiating service '${id}'`
			);
		}
		this.activeInstantiations.add(id);
		try {
			return this.createAndCacheServiceInstance(id, desc);
		} finally {
			this.activeInstantiations.delete(id);
		}
	}

	private createAndCacheServiceInstance(
		id: ServiceIdentifier<unknown>,
		desc: SyncDescriptor<unknown>
	): unknown {
		const graph = new Graph<Pending>((data) => String(data.id));
		let cycleCount = 0;
		const stack: Pending[] = [{ id, desc }];
		const seen = new Set<string>();
		while (stack.length) {
			const item = stack.pop()!;
			if (seen.has(String(item.id))) continue;
			seen.add(String(item.id));
			graph.lookupOrInsertNode(item);
			// a weak but working heuristic for cycle checks
			if (cycleCount++ > 1000) throw new CyclicDependencyError(graph);
			for (const dependency of getServiceDependencies(item.desc.ctor)) {
				const entry = this.getServiceInstanceOrDescriptor(
					dependency.id
				);
				if (!entry) {
					this.throwIfStrict(
						`[createInstance] ${item.id} depends on ${dependency.id} which is NOT registered.`
					);
				}
				if (entry instanceof SyncDescriptor) {
					const next = {
						id: dependency.id,
						desc: entry as SyncDescriptor<unknown>,
					};
					graph.insertEdge(item, next);
					stack.push(next);
				}
			}
		}
		for (;;) {
			const leaves = graph.leaves();
			// with no leaves left, a graph that is not empty is a cycle
			if (leaves.length === 0) {
				if (!graph.isEmpty()) throw new CyclicDependencyError(graph);
				break;
			}
			for (const { data } of leaves) {
				// it may have been built in the meantime
				if (
					this.getServiceInstanceOrDescriptor(data.id) instanceof
					SyncDescriptor
				) {
					const instance = this.createServiceInstanceWithOwner(
						data.id,
						data.desc
					);
					this.setCreatedServiceInstance(data.id, instance);
				}
				graph.removeNode(data);
			}
		}
		return this.getServiceInstanceOrDescriptor(id);
	}

	/** A service registered in a parent is built by the parent, so it does not depend on this scope's services. */
	private createServiceInstanceWithOwner(
		id: ServiceIdentifier<unknown>,
		desc: SyncDescriptor<unknown>
	): unknown {
		if (this.services.get(id) instanceof SyncDescriptor) {
			return this.createServiceInstance(desc);
		}
		if (this.parent) {
			return this.parent.createServiceInstanceWithOwner(id, desc);
		}
		throw new Error(
			`illegal state - creating UNKNOWN service instance ${id}`
		);
	}

	private createServiceInstance(desc: SyncDescriptor<unknown>): unknown {
		const result = this.construct(desc.ctor, [...desc.staticArguments]);
		this.servicesToMaybeDispose.add(result);
		return result;
	}
}

function isDisposable(value: unknown): value is Disposable {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Disposable)[Symbol.dispose] === "function"
	);
}
