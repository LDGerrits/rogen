import { PlannedFile } from "../toolchain/toolchain.js";
import { agentHook } from "./agent-hook.js";

export const HOOK_SCRIPT_FILE = ".claude/hooks/rogen-stop.sh";
export const HOOK_SETTINGS_FILE = ".claude/settings.json";

/** Run through bash, so the script needs no executable bit. */
const HOOK_COMMAND = `bash "$CLAUDE_PROJECT_DIR"/${HOOK_SCRIPT_FILE}`;

/** What registering the hook does to the Claude Code settings. */
export type HookRegistration =
	| { readonly kind: "added"; readonly text: string }
	| { readonly kind: "present" }
	| { readonly kind: "unreadable" };

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function indentOf(text: string): string {
	return /^\t/m.test(text) ? "\t" : (/^( +)\S/m.exec(text)?.[1] ?? "\t");
}

/** The settings text with the Stop hook registered, or why it can't be: it names the script already, or isn't plain JSON of the shape Claude Code reads. `text` is `undefined` when the file doesn't exist. */
export function registerHook(text: string | undefined): HookRegistration {
	let settings: unknown = {};
	if (text !== undefined) {
		try {
			settings = JSON.parse(text);
		} catch {
			return { kind: "unreadable" };
		}
	}
	if (!isObject(settings)) return { kind: "unreadable" };
	const { hooks = {} } = settings;
	if (!isObject(hooks)) return { kind: "unreadable" };
	const { Stop: stop = [] } = hooks;
	if (!Array.isArray(stop)) return { kind: "unreadable" };
	if (JSON.stringify(stop).includes("rogen-stop.sh"))
		return { kind: "present" };

	const registered = {
		...settings,
		hooks: {
			...hooks,
			Stop: [
				...stop,
				{ hooks: [{ type: "command", command: HOOK_COMMAND }] },
			],
		},
	};
	const json = JSON.stringify(registered, null, indentOf(text ?? ""));
	return {
		kind: "added",
		text: text === undefined || text.endsWith("\n") ? `${json}\n` : json,
	};
}

/** What `init` finds of Claude Code in a directory. */
export interface ClaudeHookState {
	/** Whether the directory has a `.claude` folder or a `CLAUDE.md`. */
	readonly inUse: boolean;
	/** Whether the script is there already, which `init` never writes over. */
	readonly scriptExists: boolean;
	/** The text of `.claude/settings.json`; `undefined` when there is none. */
	readonly settings: string | undefined;
}

/** The Stop hook that reports Rogen warnings about the files a turn changed, and what it takes to write it here. */
export class ClaudeHook {
	private readonly registration: HookRegistration;

	constructor(private readonly state: ClaudeHookState) {
		this.registration = registerHook(state.settings);
	}

	/** Whether to offer it: Claude Code is in use, and neither the script nor its registration is there to write over. */
	get offered(): boolean {
		return (
			this.state.inUse &&
			!this.state.scriptExists &&
			this.registration.kind === "added"
		);
	}

	/** The script, then the settings with it registered. */
	get files(): PlannedFile[] {
		if (this.registration.kind !== "added") return [];
		const exists = this.state.settings !== undefined;
		return [
			{ fileName: HOOK_SCRIPT_FILE, content: agentHook },
			{
				fileName: HOOK_SETTINGS_FILE,
				content: this.registration.text,
				...(exists && { appends: true, summary: "the Rogen hook" }),
			},
		];
	}
}
