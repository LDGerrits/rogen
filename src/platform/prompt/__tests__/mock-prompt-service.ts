import {
	ConfirmPromptOptions,
	MultiSelectPromptOptions,
	PromptDetails,
	PromptService,
	SelectPromptOptions,
	TextPromptOptions,
} from "../prompt-service.js";

export const ACCEPT_DEFAULT = Symbol("acceptDefault");
export const CANCEL = Symbol("cancel");

export type ScriptedAnswer =
	| string
	| boolean
	| readonly string[]
	| typeof ACCEPT_DEFAULT
	| typeof CANCEL;

export type ScriptedAnswers = Readonly<Record<string, ScriptedAnswer>>;

/** Answers in the order asked, or by question. */
export type PromptScript = readonly ScriptedAnswer[] | ScriptedAnswers;

const isAnswerList = (
	answers: PromptScript
): answers is readonly ScriptedAnswer[] => Array.isArray(answers);

const scriptedByQuestion = new Set<MockPromptService>();

// A named answer no question took would let a test pass on the default.
afterEach(() => {
	const unused = [...scriptedByQuestion].flatMap((prompts) =>
		prompts.unusedAnswers()
	);
	scriptedByQuestion.clear();
	if (unused.length > 0)
		throw new Error(
			`No question asked for the answers to ${unused.map((message) => `"${message}"`).join(", ")}.`
		);
});

export interface AskedPrompt extends PromptDetails {
	readonly message: string;
	readonly placeholder?: string;
}

export class MockPromptService implements PromptService {
	declare readonly _serviceBrand: undefined;

	readonly asked: string[] = [];
	readonly prompts: AskedPrompt[] = [];
	private readonly answers: ScriptedAnswer[] = [];
	private readonly byQuestion?: ScriptedAnswers;

	/** Scripted by question, a question not named takes its default, or fails when it has none. */
	constructor(
		answers: PromptScript = [],
		readonly isInteractive = true
	) {
		if (isAnswerList(answers)) this.answers.push(...answers);
		else {
			this.byQuestion = answers;
			scriptedByQuestion.add(this);
		}
	}

	unusedAnswers(): string[] {
		return Object.keys(this.byQuestion ?? {}).filter(
			(message) => !this.asked.includes(message)
		);
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

	async confirm(options: ConfirmPromptOptions): Promise<boolean | undefined> {
		return this.next<boolean>(options, options.initialValue);
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
		if (this.byQuestion && this.asked.includes(message))
			throw new Error(
				`"${message}" was asked again; script the answers as a list.`
			);
		this.asked.push(message);
		this.prompts.push({ message, placeholder, description, hint });
		const answer = this.byQuestion
			? this.answerFor(message, initial)
			: this.answers.shift();
		if (answer === undefined) {
			throw new Error(`No scripted answer for "${message}".`);
		}
		if (answer === CANCEL) return undefined;
		return answer === ACCEPT_DEFAULT ? initial : (answer as T);
	}

	private answerFor(
		message: string,
		initial: unknown
	): ScriptedAnswer | undefined {
		const byQuestion = this.byQuestion ?? {};
		if (Object.hasOwn(byQuestion, message)) return byQuestion[message];
		return initial === undefined ? undefined : ACCEPT_DEFAULT;
	}
}
