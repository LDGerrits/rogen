import { isObject } from "../../base/objects.js";

export const HOOK_SCRIPT_FILE = ".agents/hooks/rogen-check.sh";

/** A hook file that names the script has the hook. */
const SCRIPT_NAMED = new RegExp(
	HOOK_SCRIPT_FILE.slice(HOOK_SCRIPT_FILE.lastIndexOf("/") + 1).replace(
		".",
		"\\."
	)
);

/** What registering the hook does to an agent's hook file. */
export type HookRegistration =
	| { readonly kind: "added"; readonly text: string }
	| { readonly kind: "present" }
	| { readonly kind: "unreadable" };

/** What an agent's hook file needs for the hook. */
export interface HookEntry {
	/** The event the agent runs it on when its turn ends. */
	readonly event: string;
	/** The entry in the event's list, as the agent writes it. */
	readonly entry: unknown;
	/** What a file without one starts with, for an agent whose files carry one. */
	readonly version?: number;
}

function indentOf(text: string): string {
	return /^\t/m.test(text) ? "\t" : (/^( +)\S/m.exec(text)?.[1] ?? "\t");
}

/** The file's text with the entry added to its event, or why it can't be: the file names the script already, or isn't plain JSON of the shape the agents read. `text` is `undefined` when the file doesn't exist. */
export function withHook(
	text: string | undefined,
	{ event, entry, version }: HookEntry
): HookRegistration {
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
	const { [event]: listed = [] } = hooks;
	if (!Array.isArray(listed)) return { kind: "unreadable" };
	if (SCRIPT_NAMED.test(JSON.stringify(listed))) return { kind: "present" };

	const registered = {
		...(version !== undefined &&
			settings.version === undefined && { version }),
		...settings,
		hooks: { ...hooks, [event]: [...listed, entry] },
	};
	const json = JSON.stringify(registered, null, indentOf(text ?? ""));
	return {
		kind: "added",
		text: text === undefined || text.endsWith("\n") ? `${json}\n` : json,
	};
}

/** A coding agent that runs a hook when its turn ends, and where it reads it from. */
export interface HookTarget {
	readonly name: string;
	/** The hook file `init` adds the hook to. */
	readonly settingsFile: string;
	/** Paths in the project that say the agent is in use. */
	readonly signs: readonly string[];
	/** What the user still does by hand once it's written. */
	readonly afterwards?: string;
	/** What its hook file needs for the hook. */
	readonly hook: HookEntry;
}

/** The shape Claude Code, Codex and Gemini CLI share: a group of command hooks. */
const group = (command: string) => ({
	hooks: [{ type: "command", command }],
});

export const HOOK_TARGETS: readonly HookTarget[] = [
	{
		name: "Claude Code",
		settingsFile: ".claude/settings.json",
		signs: [".claude", "CLAUDE.md"],
		hook: {
			event: "Stop",
			entry: group(`bash "$CLAUDE_PROJECT_DIR"/${HOOK_SCRIPT_FILE}`),
		},
	},
	{
		name: "Codex",
		settingsFile: ".codex/hooks.json",
		signs: [".codex"],
		afterwards:
			"Codex runs a new hook only once you trust it: open /hooks in Codex to review it.",
		hook: {
			event: "Stop",
			entry: group(
				`bash "$(git rev-parse --show-toplevel)"/${HOOK_SCRIPT_FILE}`
			),
		},
	},
	{
		name: "Gemini CLI",
		settingsFile: ".gemini/settings.json",
		signs: [".gemini", "GEMINI.md"],
		hook: {
			event: "AfterAgent",
			entry: group(`bash "$GEMINI_PROJECT_DIR"/${HOOK_SCRIPT_FILE}`),
		},
	},
	{
		name: "Cursor",
		settingsFile: ".cursor/hooks.json",
		signs: [".cursor"],
		hook: {
			event: "stop",
			entry: { command: `bash ${HOOK_SCRIPT_FILE} cursor` },
			version: 1,
		},
	},
	{
		name: "Copilot",
		settingsFile: ".github/hooks/rogen.json",
		signs: [".github/copilot-instructions.md", ".github/hooks"],
		hook: {
			event: "agentStop",
			entry: {
				type: "command",
				bash: `bash "$(git rev-parse --show-toplevel)"/${HOOK_SCRIPT_FILE}`,
			},
			version: 1,
		},
	},
];
