import { renderAgentHookModule } from "../generate-agent-hook.js";

describe("scripts/generate-agent-hook", () => {
	it("should embed the script of the agents page", () => {
		expect(
			renderAgentHookModule(
				'text\n\n```bash title=".agents/hooks/rogen-check.sh"\n#!/usr/bin/env bash\nexit 0\n```\n'
			)
		).toContain(JSON.stringify("#!/usr/bin/env bash\nexit 0\n"));
	});

	it("should read a page with Windows line endings", () => {
		expect(
			renderAgentHookModule(
				'```bash title=".agents/hooks/rogen-check.sh"\r\nexit 0\r\n```\r\n'
			)
		).toContain(JSON.stringify("exit 0\n"));
	});

	it("should refuse a page without the script", () => {
		expect(() => renderAgentHookModule("## Rogen\n")).toThrow();
	});
});
