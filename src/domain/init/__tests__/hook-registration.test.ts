import { HookEntry, registerHook } from "../hook-registration.js";

const entry = (command: string) => ({ hooks: [{ type: "command", command }] });
const SPEC: HookEntry = { event: "Stop", entry: entry("mine.sh") };

const added = (text: string | undefined, spec = SPEC) => {
	const registration = registerHook(text, spec);
	if (registration.kind !== "added") throw new Error(registration.kind);
	return registration.text;
};

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

	it("should leave the version of a file that exists as it is", () => {
		expect(
			JSON.parse(added("{}", { ...SPEC, version: 1 }))
		).not.toHaveProperty("version");
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

		expect(registerHook(settings, SPEC)).toEqual({ kind: "present" });
	});

	it("should add to the event it is given, not another", () => {
		const settings = JSON.stringify({
			hooks: { Stop: [entry("/x/rogen-check.sh")] },
		});

		expect(
			registerHook(settings, { ...SPEC, event: "AfterAgent" }).kind
		).toBe("added");
	});

	it.each([
		["comments", '{ // no\n "model": "opus" }'],
		["a list", "[]"],
		["hooks that are not an object", '{ "hooks": [] }'],
		["an event that is not a list", '{ "hooks": { "Stop": {} } }'],
	])("should not edit settings with %s", (_, settings) => {
		expect(registerHook(settings, SPEC).kind).toBe("unreadable");
	});
});
