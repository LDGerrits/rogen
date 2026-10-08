import fs from "fs";
import {
	OUTPUT,
	currentAgentHookModule,
	renderAgentHookModule,
} from "../generate-agent-hook.js";

describe("scripts/generate-agent-hook", () => {
	it("should embed the script of the agents page", () => {
		expect(
			renderAgentHookModule(
				'text\n\n```bash title=".claude/hooks/rogen-stop.sh"\n#!/usr/bin/env bash\nexit 0\n```\n'
			)
		).toContain(JSON.stringify("#!/usr/bin/env bash\nexit 0\n"));
	});

	it("should read a page with Windows line endings", () => {
		expect(
			renderAgentHookModule(
				'```bash title=".claude/hooks/rogen-stop.sh"\r\nexit 0\r\n```\r\n'
			)
		).toContain(JSON.stringify("exit 0\n"));
	});

	it("should refuse a page without the script", () => {
		expect(() => renderAgentHookModule("## Rogen\n")).toThrow();
	});

	it("should have generated the module from the current page", () => {
		expect(fs.readFileSync(OUTPUT, "utf8")).toBe(currentAgentHookModule());
	});
});
