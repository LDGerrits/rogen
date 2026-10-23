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

	it("should append an import of AGENTS.md to a CLAUDE.md beside it", () => {
		expect(
			choose({ "AGENTS.md": "y\n", "CLAUDE.md": "z\n" }).imports([])
		).toEqual([
			{
				fileName: "CLAUDE.md",
				content: "z\n\n@AGENTS.md\n",
				addition: "an import of AGENTS.md",
			},
		]);
	});

	it("should append an import of AGENTS.md to a GEMINI.md, which Gemini CLI reads in its place", () => {
		expect(choose({ "GEMINI.md": "g" }).imports([])).toEqual([
			{
				fileName: "GEMINI.md",
				content: "g\n\n@AGENTS.md\n",
				addition: "an import of AGENTS.md",
			},
		]);
	});

	it("should leave a file that imports AGENTS.md or holds the block alone", () => {
		expect(
			choose({ "AGENTS.md": "y\n", "CLAUDE.md": "@AGENTS.md\n" }).imports(
				[]
			)
		).toEqual([]);
		expect(choose({ "CLAUDE.md": "z\n" }).imports([])).toEqual([]);
		expect(
			choose({ "AGENTS.md": "y\n", "CLAUDE.md": agentBlock }).imports([])
		).toEqual([]);
	});

	it("should put the block in AGENTS.md when CLAUDE.md and GEMINI.md both exist", () => {
		const file = choose({ "CLAUDE.md": "z\n", "GEMINI.md": "g\n" });

		expect(file.fileName).toBe("AGENTS.md");
		expect(file.imports([]).map(({ fileName }) => fileName)).toEqual([
			"CLAUDE.md",
			"GEMINI.md",
		]);
	});

	it("should write an import for an agent in use that has no file of its own", () => {
		expect(choose({ "AGENTS.md": "y\n" }).imports(["GEMINI.md"])).toEqual([
			{ fileName: "GEMINI.md", content: "@AGENTS.md\n" },
		]);
	});

	it("should import nothing when the block goes into a lone CLAUDE.md", () => {
		expect(choose({ "CLAUDE.md": "z\n" }).imports(["GEMINI.md"])).toEqual(
			[]
		);
	});
});
