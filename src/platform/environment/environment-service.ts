import { ParsedArgs } from "./args.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface EnvironmentService {
	readonly _serviceBrand: undefined;

	readonly args: ParsedArgs;
	readonly cwd: string;

	readonly verbose: boolean;
	readonly quiet: boolean;
}

export const EnvironmentService =
	createServiceIdentifier<EnvironmentService>("environmentService");

export class NativeEnvironmentService implements EnvironmentService {
	declare readonly _serviceBrand: undefined;

	get verbose(): boolean {
		return !!this.args.verbose;
	}
	get quiet(): boolean {
		return !!this.args.quiet;
	}

	constructor(
		public readonly args: ParsedArgs,
		public readonly cwd: string
	) {}
}
