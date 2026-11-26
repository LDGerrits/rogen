import { Disposable } from "../../base/disposable.js";
import { Graph } from "../../base/graph.js";
import {
	ChildOptions,
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
		super(graph.findCycleSlow());
	}
}

export class CoreInstantiationService
	implements InstantiationService, Disposable
{
	declare readonly _serviceBrand: undefined;

	private readonly services: ServiceCollection;
	private readonly descriptors = new Map<
		ServiceIdentifier<unknown>,
		SyncDescriptor<unknown>
	>();
	private readonly strict: boolean;
	private readonly parent: CoreInstantiationService | undefined;
	private readonly children = new Set<CoreInstantiationService>();
	private readonly servicesToMaybeDispose = new Set<unknown>();
	private readonly activeInstantiations = new Set<
		ServiceIdentifier<unknown>
	>();
	private isDisposed = false;

	constructor(
		services: ServiceCollection,
		strict = false,
		parent?: CoreInstantiationService
	) {
		this.services = services;
		this.strict = strict;
		this.parent = parent;
		for (const id of services.ids()) {
			const entry = services.get(id);
			if (entry instanceof SyncDescriptor)
				this.descriptors.set(id, entry);
		}
		this.services.set(InstantiationService, this);
	}

	createChild(
		services: ServiceCollection,
		{ store, rebuilt = [] }: ChildOptions = {}
	): InstantiationService {
		this.throwIfDisposed();
		for (const id of rebuilt)
			if (!services.has(id)) services.set(id, this.descriptorOf(id));
		const siblings = this.children;
		const child: CoreInstantiationService =
			new (class extends CoreInstantiationService {
				override [Symbol.dispose](): void {
					siblings.delete(child);
					super[Symbol.dispose]();
				}
			})(services, this.strict, this);
		this.children.add(child);
		store?.add(child);
		return child;
	}

	createInstance<C extends Ctor, R extends InstanceType<C>>(
		ctor: C,
		...args: LeadingNonServiceArgs<ConstructorParameters<C>>
	): R;
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

	private descriptorOf(
		id: ServiceIdentifier<unknown>
	): SyncDescriptor<unknown> {
		const descriptor = this.descriptors.get(id);
		if (descriptor) return descriptor;
		if (this.parent && !this.services.has(id))
			return this.parent.descriptorOf(id);
		throw new Error(
			`[createChild] cannot rebuild ${id}: it was not registered as a descriptor.`
		);
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
		const stack: Pending[] = [{ id, desc }];
		const seen = new Set<string>();
		while (stack.length) {
			const item = stack.pop()!;
			if (seen.has(String(item.id))) continue;
			seen.add(String(item.id));
			graph.lookupOrInsertNode(item);
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
			if (leaves.length === 0) {
				if (!graph.isEmpty()) throw new CyclicDependencyError(graph);
				break;
			}
			for (const { data } of leaves) {
				if (this.isNotBuiltYet(data.id))
					this.buildServiceInstanceWithOwner(data.id, data.desc);
				graph.removeNode(data);
			}
		}
		return this.getServiceInstanceOrDescriptor(id);
	}

	private isNotBuiltYet(id: ServiceIdentifier<unknown>): boolean {
		return (
			this.getServiceInstanceOrDescriptor(id) instanceof SyncDescriptor
		);
	}

	private buildServiceInstanceWithOwner(
		id: ServiceIdentifier<unknown>,
		desc: SyncDescriptor<unknown>
	): void {
		if (this.services.get(id) instanceof SyncDescriptor)
			this.services.set(id, this.createServiceInstance(desc));
		else this.parent!.buildServiceInstanceWithOwner(id, desc);
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
