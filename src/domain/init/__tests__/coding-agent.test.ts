import { hookScript } from "../hook-script.js";
import {
	HOOK_SCRIPT_FILE,
	CODING_AGENTS,
	HookEntry,
	withHook,
} from "../coding-agent.js";

const target = (name: string) => {
	const found = CODING_AGENTS.find((candidate) => candidate.name === name);
	if (!found) throw new Error(name);
	return found;
};

const registered = (name: string) => {
	const registration = withHook(undefined, target(name).hook);
	if (registration.kind !== "added") throw new Error(registration.kind);
	return JSON.parse(registration.text);
};

const entry = (command: string) => ({ hooks: [{ type: "command", command }] });
const SPEC: HookEntry = { event: "Stop", entry: entry("mine.sh") };

const added = (text: string | undefined, spec = SPEC) => {
	const registration = withHook(text, spec);
	if (registration.kind !== "added") throw new Error(registration.kind);
	return registration.text;
};

describe("hook targets", () => {
	it("should register Claude Code's Stop hook in .claude/settings.json", () => {
		expect(target("Claude Code").settingsFile).toBe(
			".claude/settings.json"
		);
		expect(registered("Claude Code")).toEqual({
			hooks: {
				Stop: [
					{
						hooks: [
							{
								type: "command",
								command:
									'bash "$CLAUDE_PROJECT_DIR"/.agents/hooks/rogen-check.sh',
							},
						],
					},
				],
			},
		});
	});

	it("should register Codex's Stop hook in .codex/hooks.json, from the repo root", () => {
		expect(target("Codex").settingsFile).toBe(".codex/hooks.json");
		expect(registered("Codex").hooks.Stop[0].hooks[0]).toEqual({
			type: "command",
			command:
				'bash "$(git rev-parse --show-toplevel)"/.agents/hooks/rogen-check.sh',
		});
	});

	it("should register Gemini CLI's AfterAgent hook in .gemini/settings.json", () => {
		expect(target("Gemini CLI").settingsFile).toBe(".gemini/settings.json");
		expect(registered("Gemini CLI").hooks.AfterAgent[0].hooks[0]).toEqual({
			type: "command",
			command: 'bash "$GEMINI_PROJECT_DIR"/.agents/hooks/rogen-check.sh',
		});
	});

	it("should register Cursor's stop hook with the cursor reply, from the project root", () => {
		expect(target("Cursor").settingsFile).toBe(".cursor/hooks.json");
		expect(registered("Cursor")).toEqual({
			version: 1,
			hooks: {
				stop: [{ command: "bash .agents/hooks/rogen-check.sh cursor" }],
			},
		});
	});

	it("should register Copilot's agentStop hook in its own file under .github/hooks", () => {
		expect(target("Copilot").settingsFile).toBe(".github/hooks/rogen.json");
		expect(registered("Copilot")).toEqual({
			version: 1,
			hooks: {
				agentStop: [
					{
						type: "command",
						bash: 'bash "$(git rev-parse --show-toplevel)"/.agents/hooks/rogen-check.sh',
					},
				],
			},
		});
	});

	it("should say where each agent leaves a sign of itself", () => {
		expect(
			Object.fromEntries(CODING_AGENTS.map((t) => [t.name, t.signs]))
		).toEqual({
			"Claude Code": [".claude", "CLAUDE.md"],
			Codex: [".codex"],
			"Gemini CLI": [".gemini", "GEMINI.md"],
			Cursor: [".cursor"],
			Copilot: [".github/copilot-instructions.md", ".github/hooks"],
		});
	});

	it("should have every command run the script the docs hold", () => {
		expect(HOOK_SCRIPT_FILE).toBe(".agents/hooks/rogen-check.sh");
		expect(hookScript).toMatch(/^#!\/usr\/bin\/env bash\n/);
		for (const { hook } of CODING_AGENTS)
			expect(withHook(undefined, hook)).toMatchObject({
				kind: "added",
			});
	});

	it("should ask Codex to be trusted, and no other agent", () => {
		expect(
			CODING_AGENTS.filter(({ afterwards }) => afterwards).map(
				({ name }) => name
			)
		).toEqual(["Codex"]);
	});
});

describe("registerHook", () => {
	it("should write new settings holding only the entry under its event", () => {
		expect(JSON.parse(added(undefined))).toEqual({
			hooks: { Stop: [entry("mine.sh")] },
		});
	});

	it("should end new settings with a newline, indented with tabs", () => {
		expect(added(undefined)).toMatch(/^\{\n\t"hooks": \{\n\t\t"Stop"/);
		expect(added(undefined).endsWith("}\n")).toBe(true);
	});

	it("should put the version of a new file first", () => {
		const text = added(undefined, { ...SPEC, version: 1 });

		expect(Object.keys(JSON.parse(text))).toEqual(["version", "hooks"]);
	});

	it("should add the version to a file that has none", () => {
		const text = added('{ "other": 1 }', { ...SPEC, version: 1 });

		expect(Object.keys(JSON.parse(text))).toEqual([
			"version",
			"other",
			"hooks",
		]);
	});

	it("should leave the version a file has as it is", () => {
		expect(
			JSON.parse(added('{ "version": 2 }', { ...SPEC, version: 1 }))
				.version
		).toBe(2);
	});

	it("should keep what the settings already hold", () => {
		const settings = JSON.stringify({
			model: "opus",
			hooks: {
				Stop: [entry("other.sh")],
				PreToolUse: [entry("guard.sh")],
			},
		});

		expect(JSON.parse(added(settings))).toEqual({
			model: "opus",
			hooks: {
				Stop: [entry("other.sh"), entry("mine.sh")],
				PreToolUse: [entry("guard.sh")],
			},
		});
	});

	it("should add the hooks of settings that have none", () => {
		expect(JSON.parse(added('{ "model": "opus" }'))).toEqual({
			model: "opus",
			hooks: { Stop: [entry("mine.sh")] },
		});
	});

	it("should keep the indentation of the file", () => {
		expect(added('{\n    "model": "opus"\n}\n')).toMatch(
			/^\{\n {4}"model"/
		);
		expect(added('{\n\t"model": "opus"\n}')).toMatch(/^\{\n\t"model"/);
		expect(added('{\n\t"model": "opus"\n}').endsWith("}")).toBe(true);
	});

	it("should leave settings that already name the script", () => {
		const settings = JSON.stringify({
			hooks: {
				Stop: [entry('"$DIR"/.agents/hooks/rogen-check.sh')],
			},
		});

		expect(withHook(settings, SPEC)).toEqual({ kind: "present" });
	});

	it("should add to the event it is given, not another", () => {
		const settings = JSON.stringify({
			hooks: { Stop: [entry("/x/rogen-check.sh")] },
		});

		expect(withHook(settings, { ...SPEC, event: "AfterAgent" }).kind).toBe(
			"added"
		);
	});

	it.each([
		["comments", '{ // no\n "model": "opus" }'],
		["a list", "[]"],
		["hooks that are not an object", '{ "hooks": [] }'],
		["an event that is not a list", '{ "hooks": { "Stop": {} } }'],
	])("should not edit settings with %s", (_, settings) => {
		expect(withHook(settings, SPEC).kind).toBe("unreadable");
	});
});
