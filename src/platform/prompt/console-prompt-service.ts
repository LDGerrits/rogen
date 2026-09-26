import * as clack from "@clack/prompts";
import { styleText } from "util";
import {
	MultiSelectPromptOptions,
	PromptDetails,
	PromptChoice,
	PromptService,
	SelectPromptOptions,
	TextPromptOptions,
} from "./prompt-service.js";

const toOption = <T extends string>({ value, label, hint }: PromptChoice<T>) =>
	({ value, label, hint }) as clack.Option<T>;

const GUTTER = styleText("gray", "│");

const withDetails = (message: string, { description, hint }: PromptDetails) => {
	const lines = [description, hint]
		.filter((text): text is string => text !== undefined)
		.flatMap((text) => text.split("\n"));
	return [
		message,
		...lines.map((line) => `${GUTTER}  ${styleText("dim", line)}`),
	].join("\n");
};

export class ConsolePromptService implements PromptService {
	declare readonly _serviceBrand: undefined;

	readonly isInteractive = Boolean(
		process.stdin.isTTY && process.stdout.isTTY
	);

	async text(options: TextPromptOptions): Promise<string | undefined> {
		const { placeholder = "" } = options;
		const answer = await clack.text({
			message: withDetails(options.message, options),
			placeholder,
			defaultValue: placeholder,
			validate:
				options.validate &&
				((value) => options.validate?.(value || placeholder)),
		});
		return clack.isCancel(answer) ? undefined : answer;
	}

	async select<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined> {
		const answer = await clack.select<T>({
			message: withDetails(options.message, options),
			options: options.choices.map(toOption),
			initialValue: options.initialValue,
		});
		return clack.isCancel(answer) ? undefined : answer;
	}

	async multiSelect<T extends string>(
		options: MultiSelectPromptOptions<T>
	): Promise<readonly T[] | undefined> {
		const answer = await clack.multiselect<T>({
			message: withDetails(options.message, options),
			options: options.choices.map(toOption),
			initialValues: options.initialValues && [...options.initialValues],
			required: false,
		});
		return clack.isCancel(answer) ? undefined : answer;
	}
}
