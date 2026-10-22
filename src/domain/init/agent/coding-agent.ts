import { isObject } from "../../../base/objects.js";

export const HOOK_SCRIPT_FILE = ".agents/hooks/rogen-check.mjs";

const SCRIPT_NAMED = /rogen-check\.(mjs|sh)/;

type HookRegistration =
	| { readonly kind: "added"; readonly text: string }
	| { readonly kind: "present" }
	| { readonly kind: "unreadable" };

export interface HookEntry {
	readonly event: string;
	readonly entry: unknown;
	readonly version?: number;
}

function indentOf(text: string): string {
	return /^\t/m.test(text) ? "\t" : (/^( +)\S/m.exec(text)?.[1] ?? "\t");
}

/** `text` is `undefined` when the file doesn't exist. */
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

/** The file Claude Code reads its hooks from, which marks it among the agents. */
export const CLAUDE_SETTINGS_FILE = ".claude/settings.json";

export interface CodingAgent {
	readonly name: string;
	readonly settingsFile: string;
	readonly signs: readonly string[];
	readonly afterwards?: string;
	readonly hook: HookEntry;
}

/** The shape Claude Code, Codex and Gemini CLI share: a group of command hooks. */
const group = (command: string) => ({
	hooks: [{ type: "command", command }],
});

export const CODING_AGENTS: readonly CodingAgent[] = [
	{
		name: "Claude Code",
		settingsFile: CLAUDE_SETTINGS_FILE,
		signs: [".claude", "CLAUDE.md"],
		hook: {
			event: "Stop",
			entry: group(`node "$CLAUDE_PROJECT_DIR"/${HOOK_SCRIPT_FILE}`),
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
				`node "$(git rev-parse --show-toplevel)"/${HOOK_SCRIPT_FILE}`
			),
		},
	},
	{
		name: "Gemini CLI",
		settingsFile: ".gemini/settings.json",
		signs: [".gemini", "GEMINI.md"],
		hook: {
			event: "AfterAgent",
			entry: group(`node "$GEMINI_PROJECT_DIR"/${HOOK_SCRIPT_FILE}`),
		},
	},
	{
		name: "Cursor",
		settingsFile: ".cursor/hooks.json",
		signs: [".cursor"],
		hook: {
			event: "stop",
			entry: { command: `node ${HOOK_SCRIPT_FILE} cursor` },
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
				bash: `node "$(git rev-parse --show-toplevel)"/${HOOK_SCRIPT_FILE}`,
			},
			version: 1,
		},
	},
];
