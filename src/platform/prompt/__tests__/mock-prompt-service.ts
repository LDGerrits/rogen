import {
	MultiSelectPromptOptions,
	PromptService,
	SelectPromptOptions,
	TextPromptOptions,
} from "../prompt-service.js";

export const ACCEPT_DEFAULT = Symbol("acceptDefault");
export const CANCEL = Symbol("cancel");

export type ScriptedAnswer =
	string | readonly string[] | typeof ACCEPT_DEFAULT | typeof CANCEL;

export class MockPromptService implements PromptService {
	declare readonly _serviceBrand: undefined;

	readonly asked: string[] = [];
	private readonly answers: ScriptedAnswer[];

	constructor(
		answers: readonly ScriptedAnswer[] = [],
		readonly isInteractive = true
	) {
		this.answers = [...answers];
	}

	async text(options: TextPromptOptions): Promise<string | undefined> {
		const answer = this.next<string>(options.message, options.initialValue);
		if (answer === undefined) return undefined;
		const problem = options.validate?.(answer);
		if (problem !== undefined) {
			throw new Error(
				`"${answer}" rejected for "${options.message}": ${problem}`
			);
		}
		return answer;
	}

	async select<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined> {
		return this.next<T>(options.message, options.initialValue);
	}

	async multiSelect<T extends string>(
		options: MultiSelectPromptOptions<T>
	): Promise<readonly T[] | undefined> {
		return this.next<readonly T[]>(options.message, options.initialValues);
	}

	private next<T>(message: string, initial: T | undefined): T | undefined {
		this.asked.push(message);
		const answer = this.answers.shift();
		if (answer === undefined) {
			throw new Error(`No scripted answer for "${message}".`);
		}
		if (answer === CANCEL) return undefined;
		return answer === ACCEPT_DEFAULT ? initial : (answer as T);
	}
}
