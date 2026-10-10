import { AgentFile } from "../agent-file.js";
import { agentBlock } from "../agent-block.js";

const choose = (files: Record<string, string>) =>
	AgentFile.choose((name) => files[name]);

describe("AgentFile", () => {
	it("should write the block alone into a new AGENTS.md", () => {
		expect(choose({}).planned).toEqual({
			fileName: "AGENTS.md",
			content: agentBlock,
		});
	});

	it("should append the block after a blank line, keeping every byte before it", () => {
		const { content } = choose({ "AGENTS.md": "# Mine\n" }).planned;

		expect(content).toBe(`# Mine\n\n${agentBlock}`);
	});

	it("should add the line it lacks before the blank line", () => {
		const { content } = choose({ "AGENTS.md": "# Mine" }).planned;

		expect(content).toBe(`# Mine\n\n${agentBlock}`);
	});

	it("should write a file with CRLF line endings the block with CRLF too", () => {
		const { content } = choose({ "AGENTS.md": "# Mine\r\n" }).planned;

		expect(content).not.toMatch(/(?<!\r)\n/);
		expect(content.startsWith("# Mine\r\n\r\n")).toBe(true);
		expect(content.replace(/\r\n/g, "\n")).toBe(`# Mine\n\n${agentBlock}`);
	});

	it("should use a lone CLAUDE.md, and AGENTS.md when both exist", () => {
		expect(choose({ "CLAUDE.md": "x\n" }).fileName).toBe("CLAUDE.md");
		expect(
			choose({ "CLAUDE.md": "x\n", "AGENTS.md": "y\n" }).fileName
		).toBe("AGENTS.md");
	});

	it("should know a block is there when either file holds it", () => {
		expect(choose({ "AGENTS.md": agentBlock }).hasBlock).toBe(true);
		expect(
			choose({ "AGENTS.md": "y\n", "CLAUDE.md": agentBlock }).hasBlock
		).toBe(true);
		expect(choose({ "AGENTS.md": "y\n" }).hasBlock).toBe(false);
	});

	it("should tell a CLAUDE.md beside AGENTS.md to import it", () => {
		expect(
			choose({ "AGENTS.md": "y\n", "CLAUDE.md": "z\n" }).nextStep
		).toContain("@AGENTS.md");
		expect(
			choose({ "AGENTS.md": "y\n", "CLAUDE.md": "@AGENTS.md\n" }).nextStep
		).toBeUndefined();
	});
});
