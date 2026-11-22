import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { bundleCli, invocation } from "./harness.js";

const available = spawnSync("git", ["--version"]).status === 0;

(available ? describe : describe.skip)("init's renames in git", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let dir: string;

	const git = (...args: string[]) =>
		execFileSync(
			"git",
			["-c", "user.email=a@b.c", "-c", "user.name=n", ...args],
			{ cwd: dir, encoding: "utf8" }
		);

	const write = (file: string) => {
		const target = path.join(dir, file);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, "return {}\n");
	};

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-init-git-"));
		write("src/Shop/Server/A.luau");
		write("src/Trade/Server/B.luau");
		write("src/Inventory/server/C.luau");
		git("init", "-q");
		git("add", "-A");
		git("commit", "-qm", "code");
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("should leave git tracking a folder it renamed only in case under its new name", () => {
		const [command, args] = invocation(bundle.cli, [
			"init",
			"--non-interactive",
			"--no-agent-rules",
		]);
		const result = spawnSync(command, args, {
			cwd: dir,
			encoding: "utf8",
			env: { ...process.env, NO_COLOR: "1" },
		});

		expect(result.stderr).toBe("");
		expect(result.stdout).toContain(
			"Renamed src/Inventory/server to src/Inventory/Server"
		);
		expect(git("ls-files", "src").trim().split("\n")).toEqual([
			"src/Inventory/Server/C.luau",
			"src/Shop/Server/A.luau",
			"src/Trade/Server/B.luau",
		]);
		expect(git("status", "--short", "src")).toBe(
			"R  src/Inventory/server/C.luau -> src/Inventory/Server/C.luau\n"
		);
	});
});
