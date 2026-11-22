import { jest } from "@jest/globals";
import path from "path";
import { MemoryFileSystemService } from "../../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../../platform/process/__tests__/mock-process-service.js";
import { agentBlock } from "../agent-block.js";
import { AgentRules } from "../agent-rules.js";
import { CODING_AGENTS, HOOK_SCRIPT_FILE, withHook } from "../coding-agent.js";
import { hookScript } from "../hook-script.js";
import { gitOf } from "../../__tests__/init-of.js";
import { agentRulesOf } from "../../__tests__/init-of.js";

const OLD = "<!-- rogen -->\n## Rogen\n\nOld rules.\n<!-- /rogen -->\n";
const OLD_SCRIPT =
	"// Agent Stop hook: report new Rogen diagnostics about changed files before the agent ends its turn.\nprocess.chdir(process.env.CLAUDE_PROJECT_DIR);\n";

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

	it("should replace an outdated hook script", async () => {
		await write(HOOK_SCRIPT_FILE, OLD_SCRIPT);

		const updated = await rules.refresh(root);

		expect(updated).toEqual([path.join(root, HOOK_SCRIPT_FILE)]);
		expect(await read(HOOK_SCRIPT_FILE)).toBe(hookScript);
	});

	it("should keep a hook script's CRLF line endings, and leave a current one alone", async () => {
		await write(HOOK_SCRIPT_FILE, OLD_SCRIPT.replaceAll("\n", "\r\n"));

		await rules.refresh(root);

		expect(await read(HOOK_SCRIPT_FILE)).toBe(
			hookScript.replaceAll("\n", "\r\n")
		);
		expect(await rules.refresh(root)).toEqual([]);
	});

	it("should leave a hook script alone once its first line is gone", async () => {
		const own = OLD_SCRIPT.slice(OLD_SCRIPT.indexOf("\n") + 1);
		await write(HOOK_SCRIPT_FILE, own);

		expect(await rules.refresh(root)).toEqual([]);
		expect(await read(HOOK_SCRIPT_FILE)).toBe(own);
	});

	const settingsOf = (event: string, entry: unknown) =>
		JSON.stringify(
			{ model: "opus", hooks: { [event]: [entry] } },
			null,
			"\t"
		) + "\n";
	const commandGroup = (command: string) => ({
		hooks: [{ type: "command", command }],
	});
	const current = (name: string) => {
		const agent = CODING_AGENTS.find(
			(candidate) => candidate.name === name
		)!;
		const registration = withHook('{ "model": "opus" }', agent.hook);
		if (registration.kind !== "added") throw new Error(registration.kind);
		return { agent, settings: JSON.parse(registration.text) };
	};

	it.each([
		[
			"Claude Code",
			"Stop",
			'node "$CLAUDE_PROJECT_DIR"/.agents/hooks/rogen-check.mjs',
		],
		[
			"Codex",
			"Stop",
			'node "$(git rev-parse --show-toplevel)"/.agents/hooks/rogen-check.mjs',
		],
		[
			"Gemini CLI",
			"AfterAgent",
			'node "$GEMINI_PROJECT_DIR"/.agents/hooks/rogen-check.mjs',
		],
	])(
		"should bring the hook an earlier init registered for %s up to this version, keeping the rest",
		async (name, event, old) => {
			const { agent, settings } = current(name);
			await write(
				agent.settingsFile,
				settingsOf(event, commandGroup(old))
			);

			const updated = await rules.refresh(root);

			expect(updated).toEqual([path.join(root, agent.settingsFile)]);
			expect(JSON.parse(await read(agent.settingsFile))).toEqual(
				settings
			);
			expect(await rules.refresh(root)).toEqual([]);
		}
	);

	it("should keep the rest of the settings file byte for byte", async () => {
		const old =
			'{\r\n  "model":"opus",\r\n  "hooks": { "AfterAgent": [{ "hooks": [{ "type": "command", "command": "node \\"$GEMINI_PROJECT_DIR\\"/.agents/hooks/rogen-check.mjs" }] }] }\r\n}\r\n';
		await write(".gemini/settings.json", old);

		await rules.refresh(root);

		expect(await read(".gemini/settings.json")).toBe(
			old.replace(
				'node \\"$GEMINI_PROJECT_DIR\\"/.agents',
				"node .agents"
			)
		);
	});

	it("should leave settings alone that hold no hook an earlier init registered", async () => {
		const mine = settingsOf("Stop", commandGroup("node mine.mjs"));
		await write(".claude/settings.json", mine);

		expect(await rules.refresh(root)).toEqual([]);
		expect(await read(".claude/settings.json")).toBe(mine);
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
