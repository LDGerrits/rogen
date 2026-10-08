import { agentHook } from "../agent-hook.js";
import {
	HOOK_SCRIPT_FILE,
	HOOK_SETTINGS_FILE,
	registerHook,
} from "../claude-hook.js";

const COMMAND = 'bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/rogen-stop.sh';

const entry = (command: string) => ({ hooks: [{ type: "command", command }] });

const added = (settings: string | undefined) => {
	const registration = registerHook(settings);
	if (registration.kind !== "added") throw new Error(registration.kind);
	return registration.text;
};

describe("registerHook", () => {
	it("should write new settings holding only the Stop entry", () => {
		expect(JSON.parse(added(undefined))).toEqual({
			hooks: { Stop: [entry(COMMAND)] },
		});
	});

	it("should end new settings with a newline, indented with tabs", () => {
		expect(added(undefined)).toMatch(/^\{\n\t"hooks": \{\n\t\t"Stop"/);
		expect(added(undefined).endsWith("}\n")).toBe(true);
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
				Stop: [entry("other.sh"), entry(COMMAND)],
				PreToolUse: [entry("guard.sh")],
			},
		});
	});

	it("should add the hooks of settings that have none", () => {
		expect(JSON.parse(added('{ "model": "opus" }'))).toEqual({
			model: "opus",
			hooks: { Stop: [entry(COMMAND)] },
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
				Stop: [
					entry('"$CLAUDE_PROJECT_DIR"/.claude/hooks/rogen-stop.sh'),
				],
			},
		});

		expect(registerHook(settings)).toEqual({ kind: "present" });
	});

	it.each([
		["comments", '{ // no\n "model": "opus" }'],
		["a list", "[]"],
		["hooks that are not an object", '{ "hooks": [] }'],
		["a Stop that is not a list", '{ "hooks": { "Stop": {} } }'],
	])("should not edit settings with %s", (_, settings) => {
		expect(registerHook(settings).kind).toBe("unreadable");
	});

	it("should name the files it writes", () => {
		expect([HOOK_SCRIPT_FILE, HOOK_SETTINGS_FILE]).toEqual([
			".claude/hooks/rogen-stop.sh",
			".claude/settings.json",
		]);
	});

	it("should embed the script of the agents page", () => {
		expect(agentHook).toMatch(/^#!\/usr\/bin\/env bash\n/);
		expect(agentHook).toContain("rogen check");
	});
});
