import {
	HookEntry,
	HookRegistration,
	registerHook,
} from "./hook-registration.js";

export const HOOK_SCRIPT_FILE = ".agents/hooks/rogen-check.sh";

/** A coding agent that runs a hook when its turn ends, and where it reads it from. */
export interface HookTarget {
	readonly name: string;
	/** The hook file `init` adds the hook to. */
	readonly settingsFile: string;
	/** Paths in the project that say the agent is in use. */
	readonly signs: readonly string[];
	/** What the user still does by hand once it's written. */
	readonly afterwards?: string;
	/** The file's text with the hook registered. */
	register(text: string | undefined): HookRegistration;
}

const target = (
	spec: Omit<HookTarget, "register"> & { readonly hook: HookEntry }
): HookTarget => ({
	...spec,
	register: (text) => registerHook(text, spec.hook),
});

/** The shape Claude Code, Codex and Gemini CLI share: a group of command hooks. */
const group = (command: string) => ({
	hooks: [{ type: "command", command }],
});

export const HOOK_TARGETS: readonly HookTarget[] = [
	target({
		name: "Claude Code",
		settingsFile: ".claude/settings.json",
		signs: [".claude", "CLAUDE.md"],
		hook: {
			event: "Stop",
			entry: group(`bash "$CLAUDE_PROJECT_DIR"/${HOOK_SCRIPT_FILE}`),
		},
	}),
	target({
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
	}),
	target({
		name: "Gemini CLI",
		settingsFile: ".gemini/settings.json",
		signs: [".gemini", "GEMINI.md"],
		hook: {
			event: "AfterAgent",
			entry: group(`bash "$GEMINI_PROJECT_DIR"/${HOOK_SCRIPT_FILE}`),
		},
	}),
	target({
		name: "Cursor",
		settingsFile: ".cursor/hooks.json",
		signs: [".cursor"],
		hook: {
			event: "stop",
			entry: { command: `bash ${HOOK_SCRIPT_FILE} cursor` },
			version: 1,
		},
	}),
	target({
		name: "Copilot",
		settingsFile: ".github/hooks/rogen.json",
		signs: [".github/copilot-instructions.md", ".github/hooks"],
		hook: {
			event: "agentStop",
			entry: { type: "command", bash: `bash ${HOOK_SCRIPT_FILE}` },
			version: 1,
		},
	}),
];
