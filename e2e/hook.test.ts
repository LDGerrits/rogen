import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { bundleCli } from "./harness.js";

const ROOT = path.join(import.meta.dirname, "..");

const script = fs
	.readFileSync(path.join(ROOT, "docs/content/docs/v2/agents.mdx"), "utf8")
	.replace(/\r\n/g, "\n")
	.match(
		/```bash title="\.claude\/hooks\/rogen-stop\.sh"\n([\s\S]*?)\n```/
	)?.[1];

const has = (tool: string) =>
	spawnSync(tool, ["--version"], { stdio: "ignore" }).status === 0;
const available = has("bash") && has("git") && has("jq");

(available ? describe : describe.skip)("Claude Code Stop hook", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let dir: string;
	let bin: string;

	const git = (...args: string[]) =>
		execFileSync(
			"git",
			["-c", "user.email=a@b.c", "-c", "user.name=n", ...args],
			{ cwd: path.join(dir, "project"), stdio: "ignore" }
		);

	const write = (file: string, text = "return {}\n") => {
		const target = path.join(dir, "project", file);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, text);
	};

	const stop = (session = "s1") => {
		const result = spawnSync("bash", [path.join(dir, "rogen-stop.sh")], {
			input: JSON.stringify({ session_id: session }),
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${bin}${path.delimiter}${process.env.PATH}`,
				CLAUDE_PROJECT_DIR: path.join(dir, "project"),
				NO_COLOR: "1",
			},
		});
		return {
			exit: result.status,
			report: result.stderr.split("\n").slice(1).filter(Boolean),
		};
	};

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-hook-"));
		bin = path.join(dir, "bin");
		fs.mkdirSync(bin);
		fs.writeFileSync(path.join(dir, "rogen-stop.sh"), script!);
		const wrapper = path.join(bin, "rogen");
		fs.writeFileSync(
			wrapper,
			`#!/bin/sh\nexec "${process.execPath}" "${bundle.cli}" "$@"\n`
		);
		fs.chmodSync(wrapper, 0o755);

		fs.mkdirSync(path.join(dir, "project"));
		execFileSync("git", ["init", "-q"], {
			cwd: path.join(dir, "project"),
		});
		write(
			"default.rogen.json",
			JSON.stringify({
				rootDirs: ["src"],
				routes: {
					Server: "ServerScriptService",
					Shared: "ReplicatedStorage/Shared",
					"*": "ReplicatedStorage/Shared",
				},
			})
		);
		write("lobby.rogen.json", '{ "extends": "default.rogen.json" }');
		write("src/Old@sevre.luau");
		write("src/Save.luau");
		git("add", "-A");
		git("commit", "-qm", "init");
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("should be in the agents docs", () => {
		expect(script).toMatch(/^#!\/usr\/bin\/env bash\n/);
	});

	it("should say nothing about a clean file, or the warning that was there before", () => {
		write("src/Clean.luau");

		expect(stop()).toEqual({ exit: 0, report: [] });
	});

	it("should report each new warning once, one line each, and only what is new after a fix", () => {
		write("src/Clean.luau");
		stop();

		write("src/Buy@sever.luau");
		git("mv", "src/Save.luau", "src/Save.client.luau");
		const first = stop();

		expect(first.exit).toBe(2);
		expect(first.report).toEqual([
			expect.stringMatching(
				/^src\/Buy@sever\.luau: warning: .*\(route\.strayAt\)$/
			),
			expect.stringMatching(
				/^src\/Save\.client\.luau: warning: .*\(tree\.deadScript\)$/
			),
		]);

		expect(stop()).toEqual({ exit: 0, report: [] });

		fs.renameSync(
			path.join(dir, "project/src/Buy@sever.luau"),
			path.join(dir, "project/src/Buy@Server.luau")
		);
		write("src/Tax.shared.luau");
		const fixed = stop();

		expect(fixed.exit).toBe(2);
		expect(fixed.report).toEqual([
			expect.stringMatching(
				/^src\/Tax\.shared\.luau: warning: .*\(route\.dotRoute\)$/
			),
		]);
	});

	it("should report again in another session", () => {
		write("src/Buy@sever.luau");
		stop("s1");

		expect(stop("s2").exit).toBe(2);
	});

	it("should do nothing without a config in the project dir", () => {
		fs.rmSync(path.join(dir, "project/default.rogen.json"));
		fs.rmSync(path.join(dir, "project/lobby.rogen.json"));
		write("src/Buy@sever.luau");

		expect(stop()).toEqual({ exit: 0, report: [] });
	});
});
