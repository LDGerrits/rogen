import {
	ConfirmPromptOptions,
	PromptService,
	SelectPromptOptions,
} from "../../platform/prompt/prompt-service.js";

/** How a run that shows its plan first asks: `quick` takes the default of every question the plan shows, `customise` asks those, each with the answer given before preselected. */
export type ReviewMode = "quick" | "customise";

/** Answers questions for a run that shows its whole plan once and lets the user accept it, so only what can't be detected is asked. A question that is always asked is asked once in either mode and remembered by its id, else its message, so the plan shown again doesn't ask it twice. */
export class ReviewPrompts {
	mode: ReviewMode = "quick";
	/** How many questions this pass put, answered or taken by default. */
	asked = 0;
	/** How many of them were quick ones, which Customise asks. */
	customisable = 0;
	private answers = new Map<string, unknown>();
	private before = new Map<string, unknown>();

	/** For the questions whose default the plan shows. */
	readonly quick: PromptService;

	/** For the questions that are always asked. */
	readonly essential: PromptService;

	constructor(private readonly real: PromptService) {
		this.quick = this.view(false);
		this.essential = this.view(true);
	}

	/** A new pass over the questions. */
	begin(mode: ReviewMode): void {
		this.mode = mode;
		this.asked = 0;
		this.customisable = 0;
		this.before = new Map(this.answers);
	}

	/** Forgets what this pass answered, as when the user backs out of it. */
	undo(): void {
		this.answers = new Map(this.before);
	}

	private async answer<T>(
		key: string,
		essential: boolean,
		fallback: T,
		ask: (initial: T | undefined) => Promise<T | undefined>
	): Promise<T | undefined> {
		this.asked++;
		if (!essential) this.customisable++;
		const known = this.answers.has(key);
		if (known && (essential || this.mode === "quick"))
			return this.answers.get(key) as T;
		if (this.mode === "quick" && !essential) return fallback;
		const answer = await ask(
			known ? (this.answers.get(key) as T) : undefined
		);
		if (answer !== undefined) this.answers.set(key, answer);
		return answer;
	}

	private view(essential: boolean): PromptService {
		return {
			_serviceBrand: undefined,
			isInteractive: true,
			confirm: (options: ConfirmPromptOptions) =>
				this.answer(
					options.id ?? options.message,
					essential,
					options.initialValue ?? true,
					(initial) =>
						this.real.confirm({
							...options,
							initialValue: initial ?? options.initialValue,
						})
				),
			select: <T extends string>(options: SelectPromptOptions<T>) =>
				this.answer<T>(
					options.id ?? options.message,
					essential,
					(options.initialValue ?? options.choices[0].value) as T,
					(initial) =>
						this.real.select({
							...options,
							initialValue: initial ?? options.initialValue,
						})
				),
		};
	}
}
