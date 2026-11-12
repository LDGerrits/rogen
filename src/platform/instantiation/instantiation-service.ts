import { DisposableStore } from "../../base/disposable.js";
import {
	BrandedService,
	ServicesAccessor,
	createDecorator,
} from "./instantiation.js";
import { ServiceCollection } from "./service-collection.js";
import { SyncDescriptor } from "./sync-descriptor.js";

/** The constructor parameters the caller passes: those before the trailing run of injected services. */
export type LeadingNonServiceArgs<Args extends unknown[]> = Args extends []
	? []
	: Args extends [...infer First, BrandedService]
		? LeadingNonServiceArgs<First>
		: Args;

export interface InstantiationService {
	readonly _serviceBrand: undefined;

	/** Builds `ctor` with `args` for its leading parameters and the services it asks for after them. */
	createInstance<
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		Ctor extends new (...args: any[]) => unknown,
		R extends InstanceType<Ctor>,
	>(
		ctor: Ctor,
		...args: LeadingNonServiceArgs<ConstructorParameters<Ctor>>
	): R;
	createInstance<T>(descriptor: SyncDescriptor<T>, ...args: unknown[]): T;

	/** Runs `fn` with an accessor that works until `fn` returns, so `fn` takes its services before its first `await`. */
	invokeFunction<R, Args extends unknown[] = []>(
		fn: (accessor: ServicesAccessor, ...args: Args) => R,
		...args: Args
	): R;

	/** An instantiation service of its own that falls back on this one for services `services` lacks, and is disposed with it. */
	createChild(
		services: ServiceCollection,
		store?: DisposableStore
	): InstantiationService;
}

export const InstantiationService = createDecorator<InstantiationService>(
	"instantiationService"
);
