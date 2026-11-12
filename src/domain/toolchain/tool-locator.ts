import { createDecorator } from "../../platform/instantiation/instantiation.js";

/** Finds a program on the PATH, then in Rokit's bin folder: the terminal that installed Rokit still has the PATH it started with, so what Rokit linked after that is not on it. */
export interface ToolLocator {
	readonly _serviceBrand: undefined;

	find(command: string): Promise<string | undefined>;
}

export const ToolLocator = createDecorator<ToolLocator>("toolLocator");
