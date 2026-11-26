import { Disposable, DisposableStore } from "../../base/disposable.js";
import {
	BrandedService,
	ServiceIdentifier,
	ServicesAccessor,
	createDecorator,
} from "./instantiation.js";
import { ServiceCollection } from "./service-collection.js";
import { SyncDescriptor } from "./sync-descriptor.js";

export type LeadingNonServiceArgs<Args extends unknown[]> = Args extends []
	? []
	: Args extends [...infer First, BrandedService]
		? LeadingNonServiceArgs<First>
		: Args;

export interface ChildOptions {
	readonly store?: DisposableStore;
	readonly rebuilt?: readonly ServiceIdentifier<unknown>[];
}

export interface InstantiationService extends Disposable {
	readonly _serviceBrand: undefined;

	createInstance<
		Ctor extends new (...args: never[]) => unknown,
		R extends InstanceType<Ctor>,
	>(
		ctor: Ctor,
		...args: LeadingNonServiceArgs<ConstructorParameters<Ctor>>
	): R;
	createInstance<T>(descriptor: SyncDescriptor<T>, ...args: unknown[]): T;

	invokeFunction<R, Args extends unknown[] = []>(
		fn: (accessor: ServicesAccessor, ...args: Args) => R,
		...args: Args
	): R;

	createChild(
		services: ServiceCollection,
		options?: ChildOptions
	): InstantiationService;
}

export const InstantiationService = createDecorator<InstantiationService>(
	"instantiationService"
);
