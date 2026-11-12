/** A service that is built when it is first asked for, from a class and the arguments that come before its injected parameters. */
export class SyncDescriptor<T> {
	readonly ctor: new (...args: never[]) => T;
	readonly staticArguments: readonly unknown[];

	constructor(
		ctor: new (...args: never[]) => T,
		staticArguments: readonly unknown[] = []
	) {
		this.ctor = ctor;
		this.staticArguments = staticArguments;
	}
}
