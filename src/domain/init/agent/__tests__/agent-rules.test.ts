import path from "path";
import { MemoryFileSystemService } from "../../../../platform/fs/memory-file-system-service.js";
import { agentBlock } from "../agent-block.js";
import { AgentRules } from "../agent-rules.js";

const OLD = "<!-- rogen -->\n## Rogen\n\nOld rules.\n<!-- /rogen -->\n";

describe("AgentRules", () => {
	const root = path.resolve("/repo");
	let fileSystem: MemoryFileSystemService;
	let rules: AgentRules;
	const write = (file: string, text: string) =>
		fileSystem.writeFile(path.join(root, file), text);
	const read = (file: string) => fileSystem.readFile(path.join(root, file));

	beforeEach(async () => {
		fileSystem = new MemoryFileSystemService();
		await fileSystem.createDirectory(path.join(root, ".git"));
		rules = new AgentRules(fileSystem);
	});

	it("should replace an outdated block, keeping every byte around it", async () => {
		await write("AGENTS.md", `# Team\n\n${OLD}\nMore.\n`);

		const updated = await rules.refresh(root);

		expect(updated).toEqual([path.join(root, "AGENTS.md")]);
		expect(await read("AGENTS.md")).toBe(
			`# Team\n\n${agentBlock}\nMore.\n`
		);
	});

	it("should leave a current block, and a file with no block, alone", async () => {
		await write("AGENTS.md", agentBlock);
		await write("CLAUDE.md", "Use tabs.\n");

		expect(await rules.refresh(root)).toEqual([]);
		expect(await read("CLAUDE.md")).toBe("Use tabs.\n");
	});

	it("should keep CRLF line endings", async () => {
		await write("CLAUDE.md", OLD.replaceAll("\n", "\r\n"));

		await rules.refresh(root);

		expect(await read("CLAUDE.md")).toBe(
			agentBlock.replaceAll("\n", "\r\n")
		);
	});

	it("should look in the folders above, up to the repository root", async () => {
		await write("AGENTS.md", OLD);
		await fileSystem.createDirectory(path.join(root, "projects/game"));

		const updated = await rules.refresh(path.join(root, "projects/game"));

		expect(updated).toEqual([path.join(root, "AGENTS.md")]);
	});

	it("should look only in the folder itself outside a repository", async () => {
		const outside = path.resolve("/home/me");
		await fileSystem.writeFile(path.join(outside, "AGENTS.md"), OLD);
		await fileSystem.createDirectory(path.join(outside, "game"));

		expect(await rules.refresh(path.join(outside, "game"))).toEqual([]);
		expect(await fileSystem.readFile(path.join(outside, "AGENTS.md"))).toBe(
			OLD
		);
	});
});
