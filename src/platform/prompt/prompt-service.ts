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

export interface TextPromptOptions extends PromptDetails {
	readonly message: string;
	readonly placeholder?: string;
	readonly validate?: (value: string) => string | undefined;
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

export interface MultiSelectPromptOptions<
	T extends string,
> extends PromptDetails {
	readonly message: string;
	readonly choices: readonly PromptChoice<T>[];
	readonly initialValues?: readonly T[];
}

/** Every prompt resolves to `undefined` when the user cancels; an empty text answer resolves to its placeholder. */
export interface PromptService {
	readonly _serviceBrand: undefined;
	readonly isInteractive: boolean;

	text(options: TextPromptOptions): Promise<string | undefined>;
	confirm(options: ConfirmPromptOptions): Promise<boolean | undefined>;
	select<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined>;
	multiSelect<T extends string>(
		options: MultiSelectPromptOptions<T>
	): Promise<readonly T[] | undefined>;
}

export const PromptService =
	createServiceIdentifier<PromptService>("promptService");
