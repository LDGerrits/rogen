import {
	ConfirmPromptOptions,
	PromptDetails,
	PromptService,
	SelectPromptOptions,
} from "../prompt-service.js";

export const ACCEPT_DEFAULT = Symbol("acceptDefault");
export const CANCEL = Symbol("cancel");

export type ScriptedAnswer =
	string | boolean | typeof ACCEPT_DEFAULT | typeof CANCEL;

export type ScriptedAnswers = Readonly<Record<string, ScriptedAnswer>>;

export type PromptScript = readonly ScriptedAnswer[] | ScriptedAnswers;

const isAnswerList = (
	answers: PromptScript
): answers is readonly ScriptedAnswer[] => Array.isArray(answers);

const scriptedByQuestion = new Set<MockPromptService>();

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
	readonly choices?: readonly string[];
	readonly choiceHints?: Readonly<Record<string, string | undefined>>;
}

export class MockPromptService implements PromptService {
	declare readonly _serviceBrand: undefined;

	readonly asked: string[] = [];
	private readonly askedIds: string[] = [];
	readonly prompts: AskedPrompt[] = [];
	private readonly answers: ScriptedAnswer[] = [];
	private readonly byQuestion?: ScriptedAnswers;

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
			(key) => !this.asked.includes(key) && !this.askedIds.includes(key)
		);
	}

	async confirm(options: ConfirmPromptOptions): Promise<boolean | undefined> {
		return this.next<boolean>(options, options.initialValue);
	}

	async select<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined> {
		return this.next<T>(
			{
				...options,
				choices: options.choices.map(({ value }) => value),
				choiceHints: Object.fromEntries(
					options.choices.map(({ value, hint }) => [value, hint])
				),
			},
			options.initialValue
		);
	}

	private next<T>(
		options: AskedPrompt,
		initial: T | undefined
	): T | undefined {
		const { id, message, description, hint, choices, choiceHints } =
			options;
		if (this.byQuestion && this.asked.includes(message))
			throw new Error(
				`"${message}" was asked again; script the answers as a list.`
			);
		this.asked.push(message);
		if (id !== undefined) this.askedIds.push(id);
		this.prompts.push({
			message,
			description,
			hint,
			...(choices && { choices }),
			...(choiceHints && { choiceHints }),
		});
		const answer = this.byQuestion
			? this.answerFor(id, message, initial)
			: this.answers.shift();
		if (answer === undefined) {
			throw new Error(`No scripted answer for "${message}".`);
		}
		if (answer === CANCEL) return undefined;
		return answer === ACCEPT_DEFAULT ? initial : (answer as T);
	}

	private answerFor(
		id: string | undefined,
		message: string,
		initial: unknown
	): ScriptedAnswer | undefined {
		const byQuestion = this.byQuestion ?? {};
		if (id !== undefined && Object.hasOwn(byQuestion, id))
			return byQuestion[id];
		if (Object.hasOwn(byQuestion, message)) return byQuestion[message];
		return initial === undefined ? undefined : ACCEPT_DEFAULT;
	}
}
