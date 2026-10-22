import { renderAgentHookModule } from "../generate-agent-hook.js";

describe("scripts/generate-agent-hook", () => {
	it("should embed the script of the agents page", () => {
		expect(
			renderAgentHookModule(
				'text\n\n```js title=".agents/hooks/rogen-check.mjs"\n// hook\nprocess.exit(0);\n```\n'
			)
		).toContain(JSON.stringify("// hook\nprocess.exit(0);\n"));
	});

	it("should read a page with Windows line endings", () => {
		expect(
			renderAgentHookModule(
				'```js title=".agents/hooks/rogen-check.mjs"\r\nexit 0\r\n```\r\n'
			)
		).toContain(JSON.stringify("exit 0\n"));
	});

	it("should refuse a page without the script", () => {
		expect(() => renderAgentHookModule("## Rogen\n")).toThrow();
	});
});
