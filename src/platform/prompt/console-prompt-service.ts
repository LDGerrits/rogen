import * as clack from "@clack/prompts";
import {
	MultiSelectPromptOptions,
	PromptChoice,
	PromptService,
	SelectPromptOptions,
	TextPromptOptions,
} from "./prompt-service.js";

const toOption = <T extends string>({ value, label, hint }: PromptChoice<T>) =>
	({ value, label, hint }) as clack.Option<T>;

export class ConsolePromptService implements PromptService {
	declare readonly _serviceBrand: undefined;

	readonly isInteractive = Boolean(
		process.stdin.isTTY && process.stdout.isTTY
	);

	async text(options: TextPromptOptions): Promise<string | undefined> {
		const answer = await clack.text({
			message: options.message,
			initialValue: options.initialValue,
			validate:
				options.validate &&
				((value) => options.validate?.(value ?? "")),
		});
		return clack.isCancel(answer) ? undefined : answer;
	}

	async select<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined> {
		const answer = await clack.select<T>({
			message: options.message,
			options: options.choices.map(toOption),
			initialValue: options.initialValue,
		});
		return clack.isCancel(answer) ? undefined : answer;
	}

	async multiSelect<T extends string>(
		options: MultiSelectPromptOptions<T>
	): Promise<readonly T[] | undefined> {
		const answer = await clack.multiselect<T>({
			message: options.message,
			options: options.choices.map(toOption),
			initialValues: options.initialValues && [...options.initialValues],
			required: false,
		});
		return clack.isCancel(answer) ? undefined : answer;
	}
}
