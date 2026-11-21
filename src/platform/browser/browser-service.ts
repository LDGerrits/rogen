import { createDecorator } from "../instantiation/instantiation.js";

export interface BrowserService {
	readonly _serviceBrand: undefined;

	open(url: string, cwd: string): Promise<boolean>;
}

export const BrowserService = createDecorator<BrowserService>("browserService");
