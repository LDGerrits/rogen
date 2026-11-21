import { createDecorator } from "../instantiation/instantiation.js";

export interface ReleaseService {
	readonly _serviceBrand: undefined;

	published(): Promise<readonly string[]>;

	announce(version: string): Promise<boolean>;
}

export const ReleaseService = createDecorator<ReleaseService>("releaseService");
