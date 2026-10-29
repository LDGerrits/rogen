import {
	ConfirmPrompt,
	Prompt,
	SelectPrompt,
	isCancel,
	wrapTextWithPrefix,
} from "@clack/core";
import {
	SELECT_INSTRUCTIONS,
	S_BAR,
	S_BAR_END,
	S_RADIO_ACTIVE,
	S_RADIO_INACTIVE,
	formatInstructionFooter,
	limitOptions,
	symbol,
	symbolBar,
} from "@clack/prompts";
import { Readable, Writable } from "stream";
import { style } from "../../base/style.js";
import {
	ConfirmPromptOptions,
	PromptChoice,
	PromptDetails,
	PromptService,
	SelectPromptOptions,
} from "./prompt-service.js";

type State = Prompt<unknown>["state"];

type Styler = typeof style;

const plain: Styler = (_format, text) => text;

const choiceText = <T extends string>(
	{ label, hint }: PromptChoice<T>,
	dim: (text: string) => string,
	styleLabel: (label: string) => string = (text) => text
) => `${styleLabel(label)}${hint ? ` ${dim(`(${hint})`)}` : ""}`;

interface Frame {
	readonly state: State;
	readonly message: string;
	readonly details: PromptDetails;
	readonly body: readonly string[];
	readonly answer: string;
	readonly footer?: readonly string[];
}

function drawFrame(output: Writable, frame: Frame, style: Styler): string {
	const dim = (text: string) => style("dim", text);
	const struck = (text: string) => style(["strikethrough", "dim"], text);
	const { state, message, details } = frame;
	const bar = `${symbolBar(state) ?? style("gray", S_BAR)}  `;
	const gray = `${style("gray", S_BAR)}  `;
	const wrap = (text: string, prefix: string, first = prefix) =>
		wrapTextWithPrefix(output, text, prefix, first);
	const head = [
		style("gray", S_BAR),
		wrap(message, bar, `${symbol(state)}  `),
	];

	if (state === "submit") {
		return [...head, wrap(dim(frame.answer), gray)].join("\n");
	}
	if (state === "cancel") {
		return [
			...head,
			...(frame.answer ? [wrap(struck(frame.answer), gray)] : []),
			style("gray", S_BAR),
		].join("\n");
	}

	const detailLines = [details.description, details.hint]
		.filter((text): text is string => text !== undefined)
		.flatMap((text) => text.split("\n"))
		.map((line) => wrap(dim(line), bar));
	return `${[
		...head,
		...detailLines,
		...frame.body.map((line) => `${bar}${line}`),
		...(frame.footer ?? [style("cyan", S_BAR_END)]),
	].join("\n")}\n`;
}

interface PromptStreams {
	readonly input?: Readable;
	readonly output?: Writable;
}

interface PromptSession extends PromptStreams {
	readonly interactive: boolean;
	readonly color: boolean;
}

export class ConsolePromptService implements PromptService {
	declare readonly _serviceBrand: undefined;

	readonly isInteractive: boolean;
	private readonly streams: Required<PromptStreams>;
	private readonly style: Styler;

	constructor({
		input = process.stdin,
		output = process.stdout,
		interactive,
		color,
	}: PromptSession) {
		this.streams = { input, output };
		this.isInteractive = interactive;
		this.style = color ? style : plain;
	}

	async confirm(options: ConfirmPromptOptions): Promise<boolean | undefined> {
		const { output } = this.streams;
		const { style } = this;
		const dim = (text: string) => style("dim", text);
		const [yes, no] = ["Yes", "No"];
		const answer = await new ConfirmPrompt({
			...this.streams,
			active: yes,
			inactive: no,
			initialValue: options.initialValue ?? true,
			render() {
				const radio = (on: boolean, label: string) =>
					on
						? `${style("green", S_RADIO_ACTIVE)} ${label}`
						: `${dim(S_RADIO_INACTIVE)} ${dim(label)}`;
				return drawFrame(
					output,
					{
						state: this.state,
						message: options.message,
						details: options,
						body: [
							`${radio(Boolean(this.value), yes)} ${dim("/")} ${radio(!this.value, no)}`,
						],
						answer: this.value ? yes : no,
					},
					style
				);
			},
		}).prompt();
		return isCancel(answer) ? undefined : answer;
	}

	async select<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined> {
		const { output } = this.streams;
		const { style } = this;
		const dim = (text: string) => style("dim", text);
		const answer = await new SelectPrompt<PromptChoice<T>>({
			...this.streams,
			options: [...options.choices],
			initialValue: options.initialValue,
			render() {
				const rows = limitOptions({
					output,
					cursor: this.cursor,
					options: this.options,
					style: (choice, active) =>
						active
							? `${style("green", S_RADIO_ACTIVE)} ${choiceText(choice, dim)}`
							: `${dim(S_RADIO_INACTIVE)} ${choiceText(choice, dim, dim)}`,
				});
				return drawFrame(
					output,
					{
						state: this.state,
						message: options.message,
						details: options,
						body: rows,
						answer: this.options[this.cursor]?.label ?? "",
						footer: formatInstructionFooter(
							SELECT_INSTRUCTIONS,
							true
						),
					},
					style
				);
			},
		}).prompt();
		return isCancel(answer) ? undefined : (answer as T);
	}
}
