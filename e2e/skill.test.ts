import fs from "fs";
import path from "path";

const ROOT = path.join(import.meta.dirname, "..");

const read = (file: string) =>
	fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const body = (text: string) =>
	text
		.replace(/^---\n[\s\S]*?\n---\n/, "")
		.split("\n")
		.filter((line) => !line.startsWith("#") && !line.startsWith("For "))
		.join("\n")
		.trim();

describe("rogen skill", () => {
	it("should match the AGENTS.md snippet in the agents docs", () => {
		const skill = read("skills/rogen/SKILL.md");
		const docs = read("docs/content/docs/v2/agents.mdx");
		const snippet = docs.match(/````md title="AGENTS\.md"\n([\s\S]*?)````/);

		expect(snippet).not.toBeNull();
		expect(body(snippet![1])).toBe(body(skill));
		expect(body(skill)).not.toBe("");
	});
});
