import { isObject } from "../../../base/objects.js";

export const HOOK_SCRIPT_FILE = ".agents/hooks/rogen-check.mjs";

const SCRIPT_NAMED = /rogen-check\.(mjs|sh)/;

type HookRegistration =
	| { readonly kind: "added"; readonly text: string }
	| { readonly kind: "present" }
	| { readonly kind: "unreadable" };

interface HookUpgrade {
	readonly from: string;
	readonly to: string;
}

export interface HookEntry {
	readonly event: string;
	readonly entry: unknown;
	readonly version?: number;
}

function indentOf(text: string): string {
	return /^\t/m.test(text) ? "\t" : (/^( +)\S/m.exec(text)?.[1] ?? "\t");
}

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

export function withHookUpgraded(
	text: string,
	{ from, to }: HookUpgrade
): string | undefined {
	if (!text.includes(from)) return undefined;
	const upgraded = text.replaceAll(from, to);
	try {
		JSON.parse(upgraded);
	} catch {
		return undefined;
	}
	return upgraded;
}

export const CLAUDE_SETTINGS_FILE = ".claude/settings.json";
export const GEMINI_SETTINGS_FILE = ".gemini/settings.json";

export interface CodingAgent {
	readonly name: string;
	readonly settingsFile: string;
	readonly signs: readonly string[];
	readonly afterwards?: string;
	readonly hook: HookEntry;
	readonly upgrade?: HookUpgrade;
}

const group = (command: string, args?: readonly string[]) => ({
	hooks: [{ type: "command", command, ...(args && { args }) }],
});

// PowerShell splits "quoted"/rest into two arguments, so each path is quoted
// whole.
const rootCommand = `node "$(git rev-parse --show-toplevel)/${HOOK_SCRIPT_FILE}"`;
const claudeScriptPath = `\${CLAUDE_PROJECT_DIR}/${HOOK_SCRIPT_FILE}`;

const upgrade = (from: string, to: string): HookUpgrade => ({
	from: JSON.stringify(from),
	to: JSON.stringify(to),
});

export const CODING_AGENTS: readonly CodingAgent[] = [
	{
		name: "Claude Code",
		settingsFile: CLAUDE_SETTINGS_FILE,
		signs: [".claude", "CLAUDE.md"],
		// Claude Code runs a hook in PowerShell where Git Bash is missing; the
		// exec form (2.1.139+) runs node without a shell.
		hook: {
			event: "Stop",
			entry: group("node", [claudeScriptPath]),
		},
		upgrade: {
			from: JSON.stringify(
				`node "$CLAUDE_PROJECT_DIR"/${HOOK_SCRIPT_FILE}`
			),
			to: `"node", "args": [${JSON.stringify(claudeScriptPath)}]`,
		},
	},
	{
		name: "Codex",
		settingsFile: ".codex/hooks.json",
		signs: [".codex"],
		afterwards:
			"Codex runs a new hook only once you trust it: open /hooks in Codex to review it.",
		hook: { event: "Stop", entry: group(rootCommand) },
		upgrade: upgrade(
			`node "$(git rev-parse --show-toplevel)"/${HOOK_SCRIPT_FILE}`,
			rootCommand
		),
	},
	{
		name: "Gemini CLI",
		settingsFile: GEMINI_SETTINGS_FILE,
		signs: [".gemini", "GEMINI.md"],
		// Gemini CLI puts a quoted path in place of $GEMINI_PROJECT_DIR, and
		// runs the hook in that folder.
		hook: {
			event: "AfterAgent",
			entry: group(`node ${HOOK_SCRIPT_FILE}`),
		},
		upgrade: upgrade(
			`node "$GEMINI_PROJECT_DIR"/${HOOK_SCRIPT_FILE}`,
			`node ${HOOK_SCRIPT_FILE}`
		),
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
				bash: rootCommand,
				powershell: rootCommand,
			},
			version: 1,
		},
	},
];
