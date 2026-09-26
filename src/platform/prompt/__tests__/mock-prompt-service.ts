import {
	MultiSelectPromptOptions,
	PromptDetails,
	PromptService,
	SelectPromptOptions,
	TextPromptOptions,
} from "../prompt-service.js";

export const ACCEPT_DEFAULT = Symbol("acceptDefault");
export const CANCEL = Symbol("cancel");

export type ScriptedAnswer =
	string | readonly string[] | typeof ACCEPT_DEFAULT | typeof CANCEL;

export interface AskedPrompt extends PromptDetails {
	readonly message: string;
	readonly placeholder?: string;
}

export class MockPromptService implements PromptService {
	declare readonly _serviceBrand: undefined;

	readonly asked: string[] = [];
	readonly prompts: AskedPrompt[] = [];
	private readonly answers: ScriptedAnswer[];

	constructor(
		answers: readonly ScriptedAnswer[] = [],
		readonly isInteractive = true
	) {
		this.answers = [...answers];
	}

	async text(options: TextPromptOptions): Promise<string | undefined> {
		const answer = this.next<string>(options, options.placeholder);
		if (answer === undefined) return undefined;
		const resolved = answer === "" ? (options.placeholder ?? "") : answer;
		const problem = options.validate?.(resolved);
		if (problem !== undefined) {
			throw new Error(
				`"${resolved}" rejected for "${options.message}": ${problem}`
			);
		}
		return resolved;
	}

	async select<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined> {
		return this.next<T>(options, options.initialValue);
	}

	async multiSelect<T extends string>(
		options: MultiSelectPromptOptions<T>
	): Promise<readonly T[] | undefined> {
		return this.next<readonly T[]>(options, options.initialValues);
	}

	private next<T>(
		options: AskedPrompt,
		initial: T | undefined
	): T | undefined {
		const { message, placeholder, description, hint } = options;
		this.asked.push(message);
		this.prompts.push({ message, placeholder, description, hint });
		const answer = this.answers.shift();
		if (answer === undefined) {
			throw new Error(`No scripted answer for "${message}".`);
		}
		if (answer === CANCEL) return undefined;
		return answer === ACCEPT_DEFAULT ? initial : (answer as T);
	}
}
