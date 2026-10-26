import fs from "fs";
import path from "path";

const ROOT = path.join(import.meta.dirname, "..");

const read = (file: string) =>
	fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const block = (skill: string) =>
	skill.match(/<!-- rogen -->\n([\s\S]*?)\n<!-- \/rogen -->/)?.[1];

describe("agent rules", () => {
	it("should hold the agent block between its markers", () => {
		expect(block(read("skills/rogen/agent-rules.md"))).toMatch(/^## Rogen\n/);
	});

	it("should match the AGENTS.md snippet in the agents docs exactly", () => {
		const docs = read("docs/content/docs/v2/agents.mdx");
		const snippet = docs.match(
			/````md title="AGENTS\.md"\n([\s\S]*?)\n````/
		);

		expect(snippet?.[1]).toBe(read("skills/rogen/agent-rules.md").trimEnd());
	});

	it("should be what the setup skill tells an agent to add", () => {
		expect(read("skills/rogen/SKILL.md")).toContain("](agent-rules.md)");
	});
});
