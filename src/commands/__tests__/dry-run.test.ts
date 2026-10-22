import path from "path";
import { commandHarness } from "./command-harness.js";
import {
	MockConfigService,
	mockEntry,
} from "../../domain/config/__tests__/mock-config-service.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { CommandLine } from "../../platform/environment/args.js";
import { NativeEnvironmentService } from "../../platform/environment/native-environment-service.js";
import { isDirectoryType } from "../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../platform/process/__tests__/mock-process-service.js";
import { Registry } from "../../platform/registry/registry.js";
import "../init/init-command.js";
import "../syncback/syncback-command.js";

const cwd = path.resolve("/repo");

const withDryRun = [
	...Registry.as<CommandRegistry>(Extensions.Commands).getCommands().values(),
]
	.filter(({ metadata }) =>
		(metadata.options ?? []).some(({ name }) => name === "dry-run")
	)
	.map(({ id }) => id)
	.sort();

/** Every file under `dir` with its text, and every folder. */
async function snapshot(
	fs: MemoryFileSystemService,
	dir: string
): Promise<Record<string, string | null>> {
	const taken: Record<string, string | null> = {};
	for (const [name, type] of await fs.readDirectory(dir)) {
		const entry = path.join(dir, name);
		if (isDirectoryType(type)) {
			taken[entry] = null;
			Object.assign(taken, await snapshot(fs, entry));
		} else taken[entry] = await fs.readFile(entry);
	}
	return taken;
}

const rojoProcesses = () => {
	const processes = new MockProcessService();
	processes.installed.set("rojo", "/bin/rojo");
	processes.outputs.set("/bin/rojo", {
		code: 0,
		stdout: "Rojo 7.7.1\n",
		stderr: "",
	});
	return processes;
};

/** Runs `command` as a dry run over a folder that holds a stale project file, and returns the folder before and after. */
async function dryRunOf(command: string) {
	const fs = new MemoryFileSystemService();
	await fs.createDirectory(cwd);
	await fs.writeFile(path.join(cwd, "src/Combat/Server/Combat.luau"), "");
	await fs.writeFile(path.join(cwd, "default.project.json"), "{}\n");
	const processes = rojoProcesses();
	const options: CommandLine["options"] = {
		"dry-run": true,
		input: "game.rbxl",
	};
	const before = await snapshot(fs, cwd);
	const running = commandHarness({
		cwd,
		fs,
		processes,
		environment: new NativeEnvironmentService(options, cwd),
		...(command === "syncback" && {
			config: new MockConfigService([
				mockEntry(
					{
						name: "repo",
						sourcePaths: [path.join(cwd, "src")],
						routes: { Server: "ServerScriptService" },
					},
					path.join(cwd, "default.rogen.json")
				),
			]),
		}),
	}).run(command, { positionals: [], options });
	if (command === "syncback") {
		for (let i = 0; i < 100 && processes.spawned.length === 0; i++)
			await new Promise((resolve) => setImmediate(resolve));
		processes.spawned[0].exit({ code: 0, signal: null });
	}
	await running;
	return { before, after: await snapshot(fs, cwd) };
}

describe("--dry-run", () => {
	it("should be an option of init and syncback only", () => {
		expect(withDryRun).toEqual(["init", "syncback"]);
	});

	it.each(withDryRun)(
		"should leave every file as it was in %s",
		async (id) => {
			const { before, after } = await dryRunOf(id);

			expect(after).toEqual(before);
		}
	);
});
