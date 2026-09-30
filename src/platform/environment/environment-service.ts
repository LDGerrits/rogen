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
