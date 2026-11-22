import { jest } from "@jest/globals";
import path from "path";
import { MemoryFileSystemService } from "../../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../../platform/process/__tests__/mock-process-service.js";
import { agentBlock } from "../agent-block.js";
import { AgentRules } from "../agent-rules.js";
import { gitOf } from "../../__tests__/init-of.js";
import { agentRulesOf } from "../../__tests__/init-of.js";

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
		rules = agentRulesOf(
			fileSystem,
			gitOf(new MockProcessService(), fileSystem)
		);
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

	it("should skip a file it can't read", async () => {
		await write("AGENTS.md", OLD);
		jest.spyOn(fileSystem, "readFile").mockRejectedValue(
			new Error("EACCES")
		);

		expect(await rules.refresh(root)).toEqual([]);
	});

	it("should leave out a file it can't write", async () => {
		await write("AGENTS.md", OLD);
		await write("CLAUDE.md", OLD);
		const writeFile = fileSystem.writeFile.bind(fileSystem);
		jest.spyOn(fileSystem, "writeFile").mockImplementation(
			async (file, text) => {
				if (file.endsWith("AGENTS.md")) throw new Error("EACCES");
				return writeFile(file, text);
			}
		);

		expect(await rules.refresh(root)).toEqual([
			path.join(root, "CLAUDE.md"),
		]);
		expect(await read("AGENTS.md")).toBe(OLD);
	});
});
