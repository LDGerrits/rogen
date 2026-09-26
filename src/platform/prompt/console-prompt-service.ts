import * as clack from "@clack/prompts";
import { Readable, Writable } from "stream";
import { styleText } from "util";
import {
	ConfirmPromptOptions,
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

interface PromptStreams {
	readonly input?: Readable & { readonly isTTY?: boolean };
	readonly output?: Writable & { readonly isTTY?: boolean };
}

export class ConsolePromptService implements PromptService {
	declare readonly _serviceBrand: undefined;

	readonly isInteractive: boolean;
	private readonly streams: Required<PromptStreams>;

	constructor({
		input = process.stdin,
		output = process.stdout,
	}: PromptStreams = {}) {
		this.streams = { input, output };
		this.isInteractive = Boolean(input.isTTY && output.isTTY);
	}

	async text(options: TextPromptOptions): Promise<string | undefined> {
		const { placeholder = "" } = options;
		const answer = await clack.text({
			...this.streams,
			message: withDetails(options.message, options),
			placeholder,
			defaultValue: placeholder,
			validate:
				options.validate &&
				((value) => options.validate?.(value || placeholder)),
		});
		return clack.isCancel(answer) ? undefined : answer;
	}

	async confirm(options: ConfirmPromptOptions): Promise<boolean | undefined> {
		const answer = await clack.confirm({
			...this.streams,
			message: withDetails(options.message, options),
			initialValue: options.initialValue,
		});
		return clack.isCancel(answer) ? undefined : answer;
	}

	async select<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined> {
		const answer = await clack.select<T>({
			...this.streams,
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
			...this.streams,
			message: withDetails(options.message, options),
			options: options.choices.map(toOption),
			initialValues: options.initialValues && [...options.initialValues],
			required: false,
		});
		return clack.isCancel(answer) ? undefined : answer;
	}
}
