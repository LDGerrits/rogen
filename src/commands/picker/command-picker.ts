import { CancelledError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	CommandRegistry,
	PickerStep,
} from "../../platform/commands/commands.js";
import { LogService } from "../../platform/log/log-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";

/** What the picker shows of the folder it runs in. */
export interface PickerProject {
	/** The version of Rogen, and the name of the nearest config's project, which is `undefined` when no config is here. */
	describe(): Promise<{
		readonly version: string;
		readonly name: string | undefined;
	}>;
	/** The project's files that end in one of `extensions`, as paths from here. */
	files(extensions: readonly string[]): Promise<readonly string[]>;
}

const CONFIGURED_FIRST = ["serve", "build", "where", "check"];
const UNCONFIGURED_FIRST = ["init"];
const LAST = ["doc", "help"];

const TYPE_A_PATH = "";

const quoted = (word: string) =>
	/^[\w@%+=:,./-]+$/.test(word) ? word : `"${word.replace(/"/g, '\\"')}"`;

/** What bare `rogen` does in a terminal: every command on one line, pick one and it runs. */
export class CommandPicker {
	constructor(
		private readonly registry: CommandRegistry,
		private readonly promptService: PromptService,
		private readonly logService: LogService,
		private readonly project: PickerProject
	) {}

	/** The commands in the order the picker lists them: what a folder with this state needs first, `doc` and `help` last. */
	static order(ids: readonly string[], configured: boolean): string[] {
		const first = configured ? CONFIGURED_FIRST : UNCONFIGURED_FIRST;
		const named = [...first, ...LAST];
		return [
			...first.filter((id) => ids.includes(id)),
			...ids.filter((id) => !named.includes(id)),
			...LAST.filter((id) => ids.includes(id)),
		];
	}

	/** The command line to run: a command and the answers it can't run without. Cancelling is a `CancelledError`. */
	async pick(): Promise<Result<string[], Error>> {
		const { version, name } = await this.project.describe();
		this.logService.intro(
			`rogen ${version} · ${name ?? "no rogen.json here"}`
		);
		const commands = this.registry.getCommands();
		const ids = CommandPicker.order(
			[...commands.keys()],
			name !== undefined
		);
		const id = await this.promptService.autocomplete({
			message: "Run a command",
			choices: ids.map((value) => ({
				value,
				label: value,
				hint: commands.get(value)?.metadata.summary,
			})),
			initialValue: ids[0],
		});
		if (id === undefined) return err(new CancelledError("cancelled."));

		const line: string[] = [id];
		for (const step of commands.get(id)?.metadata.picker ?? []) {
			const answer = await this.ask(step);
			if (answer === undefined)
				return err(new CancelledError("cancelled."));
			if (answer === "") continue;
			line.push(
				...(step.into === "positional"
					? [answer]
					: [`--${step.into.option}`, answer])
			);
		}
		this.logService.outro(`› rogen ${line.map(quoted).join(" ")}`);
		return ok(line);
	}

	private async ask(step: PickerStep): Promise<string | undefined> {
		const { message, placeholder, validate } = step;
		const choices =
			step.choices ??
			(step.files
				? [
						...(await this.project.files(step.files)).map(
							(file) => ({ value: file, label: file })
						),
					]
				: undefined);
		if (choices && choices.length > 0) {
			const typed = step.files
				? [{ value: TYPE_A_PATH, label: "Type a path…" }]
				: [];
			const answer = await this.promptService.select({
				message,
				choices: [...choices, ...typed],
			});
			if (answer !== TYPE_A_PATH || !step.files) return answer;
		}
		return this.promptService.text({ message, placeholder, validate });
	}
}
