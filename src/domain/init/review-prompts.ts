import {
	ConfirmPromptOptions,
	PromptService,
	SelectPromptOptions,
} from "../../platform/prompt/prompt-service.js";

/** How a run that shows its plan first asks: `quick` takes the default of every question the plan shows, `customise` asks those, each with the answer given before preselected. */
export type ReviewMode = "quick" | "customise";

/** Answers questions for a run that shows its whole plan once and lets the user accept it, so only what can't be detected is asked. A question that is always asked is asked once in either mode and remembered, so the plan shown again doesn't ask it twice. */
export class ReviewPrompts {
	mode: ReviewMode = "quick";
	/** How many questions this pass put, answered or taken by default. */
	asked = 0;
	/** How many of them were quick ones, which Customise asks. */
	customisable = 0;
	private readonly answers = new Map<string, unknown>();

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
	}

	private async answer<T>(
		message: string,
		essential: boolean,
		fallback: T,
		ask: (initial: T | undefined) => Promise<T | undefined>
	): Promise<T | undefined> {
		this.asked++;
		if (!essential) this.customisable++;
		const known = this.answers.has(message);
		if (known && (essential || this.mode === "quick"))
			return this.answers.get(message) as T;
		if (this.mode === "quick" && !essential) return fallback;
		const answer = await ask(
			known ? (this.answers.get(message) as T) : undefined
		);
		if (answer !== undefined) this.answers.set(message, answer);
		return answer;
	}

	private view(essential: boolean): PromptService {
		return {
			_serviceBrand: undefined,
			isInteractive: true,
			confirm: (options: ConfirmPromptOptions) =>
				this.answer(
					options.message,
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
					options.message,
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
