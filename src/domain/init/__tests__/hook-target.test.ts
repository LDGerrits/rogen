import { agentHook } from "../agent-hook.js";
import { HOOK_SCRIPT_FILE, HOOK_TARGETS } from "../hook-target.js";

const target = (name: string) => {
	const found = HOOK_TARGETS.find((candidate) => candidate.name === name);
	if (!found) throw new Error(name);
	return found;
};

const registered = (name: string) => {
	const registration = target(name).register(undefined);
	if (registration.kind !== "added") throw new Error(registration.kind);
	return JSON.parse(registration.text);
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
						bash: "bash .agents/hooks/rogen-check.sh",
					},
				],
			},
		});
	});

	it("should say where each agent leaves a sign of itself", () => {
		expect(
			Object.fromEntries(HOOK_TARGETS.map((t) => [t.name, t.signs]))
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
		expect(agentHook).toMatch(/^#!\/usr\/bin\/env bash\n/);
		for (const { register } of HOOK_TARGETS)
			expect(register(undefined)).toMatchObject({ kind: "added" });
	});

	it("should ask Codex to be trusted, and no other agent", () => {
		expect(
			HOOK_TARGETS.filter(({ afterwards }) => afterwards).map(
				({ name }) => name
			)
		).toEqual(["Codex"]);
	});
});
