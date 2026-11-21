import {
	ConfirmPromptOptions,
	PromptService,
	SelectPromptOptions,
} from "../../platform/prompt/prompt-service.js";

export type ReviewMode = "quick" | "customise";

export class ReviewPrompts {
	mode: ReviewMode = "quick";
	asked = 0;
	customisable = 0;
	private answers = new Map<string, unknown>();
	private before = new Map<string, unknown>();

	readonly quick: PromptService;

	readonly essential: PromptService;

	constructor(@PromptService private readonly real: PromptService) {
		this.quick = this.view(false);
		this.essential = this.view(true);
	}

	begin(mode: ReviewMode): void {
		this.mode = mode;
		this.asked = 0;
		this.customisable = 0;
		this.before = new Map(this.answers);
	}

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
