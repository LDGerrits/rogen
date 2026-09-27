import {
	ConfirmPrompt,
	MultiSelectPrompt,
	Prompt,
	SelectPrompt,
	TextPrompt,
	isCancel,
	wrapTextWithPrefix,
} from "@clack/core";
import {
	MULTISELECT_INSTRUCTIONS,
	SELECT_INSTRUCTIONS,
	S_BAR,
	S_BAR_END,
	S_CHECKBOX_ACTIVE,
	S_CHECKBOX_INACTIVE,
	S_CHECKBOX_SELECTED,
	S_RADIO_ACTIVE,
	S_RADIO_INACTIVE,
	formatInstructionFooter,
	limitOptions,
	symbol,
	symbolBar,
} from "@clack/prompts";
import { Readable, Writable } from "stream";
import { styleText } from "util";
import {
	ConfirmPromptOptions,
	MultiSelectPromptOptions,
	PromptChoice,
	PromptDetails,
	PromptService,
	SelectPromptOptions,
	TextPromptOptions,
} from "./prompt-service.js";

type State = Prompt<unknown>["state"];

const dim = (text: string) => styleText("dim", text);
const struck = (text: string) => styleText(["strikethrough", "dim"], text);

const choiceText = <T extends string>(
	{ label, hint }: PromptChoice<T>,
	styleLabel: (label: string) => string = (text) => text
) => `${styleLabel(label)}${hint ? ` ${dim(`(${hint})`)}` : ""}`;

interface Frame {
	readonly state: State;
	readonly message: string;
	readonly details: PromptDetails;
	/** Lines under the title while the prompt is open. */
	readonly body: readonly string[];
	/** The answer shown once the prompt is submitted or cancelled. */
	readonly answer: string;
	/** Lines under the closing corner, such as the keys or an error. */
	readonly footer?: readonly string[];
}

/** Draws one prompt: its description and hint only while it's open, then just the title and answer. */
function drawFrame(output: Writable, frame: Frame): string {
	const { state, message, details } = frame;
	const bar = `${symbolBar(state) ?? styleText("gray", S_BAR)}  `;
	const gray = `${styleText("gray", S_BAR)}  `;
	const wrap = (text: string, prefix: string, first = prefix) =>
		wrapTextWithPrefix(output, text, prefix, first);
	const head = [
		styleText("gray", S_BAR),
		wrap(message, bar, `${symbol(state)}  `),
	];

	if (state === "submit") {
		return [...head, wrap(dim(frame.answer), gray)].join("\n");
	}
	if (state === "cancel") {
		return [
			...head,
			...(frame.answer ? [wrap(struck(frame.answer), gray)] : []),
			styleText("gray", S_BAR),
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
		...(frame.footer ?? [styleText("cyan", S_BAR_END)]),
	].join("\n")}\n`;
}

const errorFooter = (error: string) => [
	`${styleText("yellow", S_BAR_END)}  ${styleText("yellow", error)}`,
];

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
		const { placeholder = "", validate } = options;
		const { output } = this.streams;
		const answer = await new TextPrompt({
			...this.streams,
			placeholder,
			defaultValue: placeholder,
			validate: validate && ((value) => validate(value || placeholder)),
			render() {
				const empty = placeholder
					? `${styleText("inverse", placeholder[0])}${dim(placeholder.slice(1))}`
					: styleText(["inverse", "hidden"], "_");
				return drawFrame(output, {
					state: this.state,
					message: options.message,
					details: options,
					body: [this.userInput ? this.userInputWithCursor : empty],
					answer: this.value ?? "",
					...(this.state === "error" && {
						footer: errorFooter(this.error),
					}),
				});
			},
		}).prompt();
		return isCancel(answer) ? undefined : answer;
	}

	async confirm(options: ConfirmPromptOptions): Promise<boolean | undefined> {
		const { output } = this.streams;
		const [yes, no] = ["Yes", "No"];
		const answer = await new ConfirmPrompt({
			...this.streams,
			active: yes,
			inactive: no,
			initialValue: options.initialValue ?? true,
			render() {
				const radio = (on: boolean, label: string) =>
					on
						? `${styleText("green", S_RADIO_ACTIVE)} ${label}`
						: `${dim(S_RADIO_INACTIVE)} ${dim(label)}`;
				return drawFrame(output, {
					state: this.state,
					message: options.message,
					details: options,
					body: [
						`${radio(Boolean(this.value), yes)} ${dim("/")} ${radio(!this.value, no)}`,
					],
					answer: this.value ? yes : no,
				});
			},
		}).prompt();
		return isCancel(answer) ? undefined : answer;
	}

	async select<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined> {
		const { output } = this.streams;
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
							? `${styleText("green", S_RADIO_ACTIVE)} ${choiceText(choice)}`
							: `${dim(S_RADIO_INACTIVE)} ${choiceText(choice, dim)}`,
				});
				return drawFrame(output, {
					state: this.state,
					message: options.message,
					details: options,
					body: rows,
					answer: this.options[this.cursor]?.label ?? "",
					footer: formatInstructionFooter(SELECT_INSTRUCTIONS, true),
				});
			},
		}).prompt();
		return isCancel(answer) ? undefined : (answer as T);
	}

	async multiSelect<T extends string>(
		options: MultiSelectPromptOptions<T>
	): Promise<readonly T[] | undefined> {
		const { output } = this.streams;
		const answer = await new MultiSelectPrompt<PromptChoice<T>>({
			...this.streams,
			options: [...options.choices],
			initialValues: options.initialValues && [...options.initialValues],
			required: false,
			render() {
				const ticked = (this.value ?? []) as T[];
				const rows = limitOptions({
					output,
					cursor: this.cursor,
					options: this.options,
					style: (choice, active) => {
						const box = ticked.includes(choice.value)
							? styleText("green", S_CHECKBOX_SELECTED)
							: active
								? styleText("cyan", S_CHECKBOX_ACTIVE)
								: dim(S_CHECKBOX_INACTIVE);
						return `${box} ${choiceText(choice, active ? undefined : dim)}`;
					},
				});
				const labels = this.options
					.filter(({ value }) => ticked.includes(value))
					.map(({ label }) => label);
				return drawFrame(output, {
					state: this.state,
					message: options.message,
					details: options,
					body: rows,
					answer:
						labels.join(", ") ||
						(this.state === "submit" ? "none" : ""),
					footer: formatInstructionFooter(
						MULTISELECT_INSTRUCTIONS,
						true
					),
				});
			},
		}).prompt();
		return isCancel(answer) ? undefined : (answer as T[]);
	}
}
