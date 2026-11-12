import {
	BrandedService,
	ServicesAccessor,
	createDecorator,
} from "./instantiation.js";

/** The constructor parameters the caller passes: those before the trailing run of injected services. */
type LeadingNonServiceArgs<Args extends unknown[]> = Args extends []
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

	/** Runs `fn` with an accessor for the services; unlike VS Code's, it keeps working after `fn` returns, since a command handler asks for services across its awaits. */
	invokeFunction<R, Args extends unknown[] = []>(
		fn: (accessor: ServicesAccessor, ...args: Args) => R,
		...args: Args
	): R;
}

export const InstantiationService = createDecorator<InstantiationService>(
	"instantiationService"
);
