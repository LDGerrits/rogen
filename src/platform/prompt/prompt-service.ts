import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface PromptChoice<T extends string> {
	readonly value: T;
	readonly label: string;
	readonly hint?: string;
}

export interface PromptDetails {
	readonly description?: string;
	readonly hint?: string;
}

export interface ConfirmPromptOptions extends PromptDetails {
	readonly message: string;
	readonly initialValue?: boolean;
}

export interface SelectPromptOptions<T extends string> extends PromptDetails {
	readonly message: string;
	readonly choices: readonly PromptChoice<T>[];
	readonly initialValue?: T;
}

/** Every prompt resolves to `undefined` when the user cancels. */
export interface PromptService {
	readonly _serviceBrand: undefined;
	readonly isInteractive: boolean;

	confirm(options: ConfirmPromptOptions): Promise<boolean | undefined>;
	select<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined>;
}

export const PromptService =
	createServiceIdentifier<PromptService>("promptService");
