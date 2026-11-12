/** A service that is built when it is first asked for, from a class and the arguments that come before its injected parameters. With `supportsDelayedInstantiation` the class is not built until something uses the service. */
export class SyncDescriptor<T> {
	readonly ctor: new (...args: never[]) => T;
	readonly staticArguments: readonly unknown[];
	readonly supportsDelayedInstantiation: boolean;

	constructor(
		ctor: new (...args: never[]) => T,
		staticArguments: readonly unknown[] = [],
		supportsDelayedInstantiation = false
	) {
		this.ctor = ctor;
		this.staticArguments = staticArguments;
		this.supportsDelayedInstantiation = supportsDelayedInstantiation;
	}
}
