import { ParsedArgs } from "./args.js";

export interface EnvironmentService {
	readonly _serviceBrand: undefined;

	readonly args: ParsedArgs;
	readonly cwd: string;

	readonly verbose: boolean;
	readonly trace: boolean;
	readonly quiet: boolean;
}

export class NativeEnvironmentService implements EnvironmentService {
	declare readonly _serviceBrand: undefined;

	get verbose(): boolean {
		return !!this.args.verbose;
	}
	get trace(): boolean {
		return !!this.args.trace;
	}
	get quiet(): boolean {
		return !!this.args.quiet;
	}

	constructor(
		public readonly args: ParsedArgs,
		public readonly cwd: string
	) {}
}
