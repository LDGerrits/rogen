import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface EnvironmentService {
	readonly _serviceBrand: undefined;

	readonly cwd: string;

	readonly verbose: boolean;
	readonly quiet: boolean;
}

export const EnvironmentService =
	createServiceIdentifier<EnvironmentService>("environmentService");
