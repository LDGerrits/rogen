import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface BrowserService {
	readonly _serviceBrand: undefined;

	/** Opens `url` in the user's browser; whether a program was started for it. */
	open(url: string, cwd: string): Promise<boolean>;
}

export const BrowserService =
	createServiceIdentifier<BrowserService>("browserService");
