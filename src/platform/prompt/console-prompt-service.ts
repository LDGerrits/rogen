import {
	AutocompletePrompt,
	ConfirmPrompt,
	MultiSelectPrompt,
	Prompt,
	SelectPrompt,
	TextPrompt,
	getColumns,
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
import { style } from "../../base/style.js";
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

const errorFooter = (error: string, style: Styler) => [
	`${style("yellow", S_BAR_END)}  ${style("yellow", error)}`,
];

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

	async text(options: TextPromptOptions): Promise<string | undefined> {
		const { placeholder = "", validate } = options;
		const { output } = this.streams;
		const { style } = this;
		const dim = (text: string) => style("dim", text);
		const answer = await new TextPrompt({
			...this.streams,
			placeholder,
			defaultValue: placeholder,
			initialValue: options.initialValue,
			validate: validate && ((value) => validate(value || placeholder)),
			render() {
				const empty = placeholder
					? `${style("inverse", placeholder[0])}${dim(placeholder.slice(1))}`
					: style(["inverse", "hidden"], "_");
				return drawFrame(
					output,
					{
						state: this.state,
						message: options.message,
						details: options,
						body: [
							this.userInput ? this.userInputWithCursor : empty,
						],
						answer: this.value ?? "",
						...(this.state === "error" && {
							footer: errorFooter(this.error, style),
						}),
					},
					style
				);
			},
		}).prompt();
		return isCancel(answer) ? undefined : answer;
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

	async autocomplete<T extends string>(
		options: SelectPromptOptions<T>
	): Promise<T | undefined> {
		const { output } = this.streams;
		const { style } = this;
		const dim = (text: string) => style("dim", text);
		const width = Math.max(
			...options.choices.map(({ label }) => label.length)
		);
		const row = ({ label, hint }: PromptChoice<T>, active: boolean) => {
			const room = Math.max(0, getColumns(output) - width - 8);
			const shown =
				hint === undefined
					? ""
					: `  ${dim(hint.length > room ? `${hint.slice(0, Math.max(0, room - 1))}…` : hint)}`;
			const name = label.padEnd(width);
			return active
				? `${style("green", S_RADIO_ACTIVE)} ${name}${shown}`
				: `${dim(S_RADIO_INACTIVE)} ${dim(name)}${shown}`;
		};
		const answer = await new AutocompletePrompt<PromptChoice<T>>({
			...this.streams,
			options: [...options.choices],
			initialValue: options.initialValue && [options.initialValue],
			filter: (search, { label, value, hint }) => {
				const needle = search.toLowerCase();
				return [label, value, hint ?? ""].some((text) =>
					text.toLowerCase().includes(needle)
				);
			},
			render() {
				const matches = this.filteredOptions;
				const typed = this.userInput;
				const count =
					matches.length === options.choices.length
						? ""
						: dim(
								` (${matches.length} match${matches.length === 1 ? "" : "es"})`
							);
				const rows =
					matches.length === 0
						? [style("yellow", "No matches found")]
						: limitOptions({
								output,
								cursor: this.cursor,
								options: matches,
								style: (choice, active) => row(choice, active),
							});
				const chosen = options.choices.find(
					({ value }) => value === this.value
				);
				return drawFrame(
					output,
					{
						state: this.state,
						message: options.message,
						details: options,
						body: [
							`${dim("Search:")} ${this.isNavigating ? dim(typed) : this.userInputWithCursor}${count}`,
							...rows,
						],
						answer: chosen?.label ?? "",
						footer: [
							`${style("cyan", S_BAR)}  ${dim("↑/↓ select · enter confirm · type to filter")}`,
							style("cyan", S_BAR_END),
						],
					},
					style
				);
			},
		}).prompt();
		if (isCancel(answer)) return undefined;
		return (Array.isArray(answer) ? answer[0] : answer) as T | undefined;
	}

	async multiSelect<T extends string>(
		options: MultiSelectPromptOptions<T>
	): Promise<readonly T[] | undefined> {
		const { output } = this.streams;
		const { style } = this;
		const dim = (text: string) => style("dim", text);
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
							? style("green", S_CHECKBOX_SELECTED)
							: active
								? style("cyan", S_CHECKBOX_ACTIVE)
								: dim(S_CHECKBOX_INACTIVE);
						return `${box} ${choiceText(choice, dim, active ? undefined : dim)}`;
					},
				});
				const labels = this.options
					.filter(({ value }) => ticked.includes(value))
					.map(({ label }) => label);
				return drawFrame(
					output,
					{
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
					},
					style
				);
			},
		}).prompt();
		return isCancel(answer) ? undefined : (answer as T[]);
	}
}
