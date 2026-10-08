import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { bundleCli, invocation } from "./harness.js";

const ROOT = path.join(import.meta.dirname, "..");

const script = fs
	.readFileSync(path.join(ROOT, "docs/content/docs/v2/agents.mdx"), "utf8")
	.replace(/\r\n/g, "\n")
	.match(
		/```bash title="\.agents\/hooks\/rogen-check\.sh"\n([\s\S]*?)\n```/
	)?.[1];

const has = (tool: string) =>
	spawnSync(tool, ["--version"], { stdio: "ignore" }).status === 0;
const available = has("bash") && has("git") && has("jq");

(available ? describe : describe.skip)("agent Stop hook", () => {
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

	const stop = (
		payload: Record<string, unknown> = { session_id: "s1" },
		args: string[] = [],
		env: Record<string, string | undefined> = {}
	) => {
		const result = spawnSync(
			"bash",
			[path.join(dir, "rogen-check.sh"), ...args],
			{
				input: JSON.stringify(payload),
				encoding: "utf8",
				env: Object.fromEntries(
					Object.entries({
						...process.env,
						PATH: `${bin}${path.delimiter}${process.env.PATH}`,
						CLAUDE_PROJECT_DIR: path.join(dir, "project"),
						NO_COLOR: "1",
						...env,
					}).filter(([, value]) => value !== undefined)
				),
			}
		);
		const reply = result.stdout.trim()
			? (JSON.parse(result.stdout) as Record<string, string>)
			: undefined;
		const message = reply?.reason ?? reply?.followup_message;
		return {
			exit: result.status,
			stderr: result.stderr,
			reply,
			report: message?.split("\n").slice(1).filter(Boolean) ?? [],
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
		fs.writeFileSync(path.join(dir, "rogen-check.sh"), script!);
		const wrapper = path.join(bin, "rogen");
		const [command, args] = invocation(bundle.cli, []);
		fs.writeFileSync(
			wrapper,
			`#!/bin/sh\nexec "${command}" ${args.map((arg) => `"${arg}"`).join(" ")} "$@"\n`
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

		expect(stop()).toMatchObject({ exit: 0, reply: undefined });
	});

	it("should report each new warning once, one line each, and only what is new after a fix", () => {
		write("src/Clean.luau");
		stop();

		write("src/Buy@sever.luau");
		git("mv", "src/Save.luau", "src/Save.client.luau");
		const first = stop();

		expect(first.exit).toBe(0);
		expect(first.reply?.decision).toBe("block");
		expect(first.stderr).toBe("");
		expect(first.report).toEqual([
			expect.stringMatching(
				/^src\/Save\.client\.luau - warning: .*\(tree\.deadScript\)$/
			),
			expect.stringMatching(
				/^src\/Buy@sever\.luau - warning: .*\(route\.strayAt\)$/
			),
		]);

		expect(stop()).toMatchObject({ exit: 0, reply: undefined });

		fs.renameSync(
			path.join(dir, "project/src/Buy@sever.luau"),
			path.join(dir, "project/src/Buy@Server.luau")
		);
		write("src/Tax.shared.luau");
		const fixed = stop();

		expect(fixed.reply?.decision).toBe("block");
		expect(fixed.report).toEqual([
			expect.stringMatching(
				/^src\/Tax\.shared\.luau - warning: .*\(route\.dotRoute\)$/
			),
		]);
	});

	it("should report again in another session", () => {
		write("src/Buy@sever.luau");
		stop({ session_id: "s1" });

		expect(stop({ session_id: "s2" }).reply?.decision).toBe("block");
	});

	it.each([
		["Copilot", { sessionId: "a" }],
		["Cursor", { conversation_id: "a" }],
	])("should key the session on the id %s sends", (_, payload) => {
		write("src/Buy@sever.luau");
		stop(payload);

		expect(stop(payload).reply).toBeUndefined();
		expect(stop({ session_id: "b" }).reply?.decision).toBe("block");
	});

	it("should ask Cursor to continue with followup_message", () => {
		write("src/Buy@sever.luau");

		const { reply } = stop({ conversation_id: "c" }, ["cursor"]);

		expect(Object.keys(reply ?? {})).toEqual(["followup_message"]);
		expect(reply?.followup_message).toContain("route.strayAt");
	});

	it("should find the project from the payload's cwd where no agent sets CLAUDE_PROJECT_DIR", () => {
		write("src/Buy@sever.luau");

		const { reply } = stop(
			{ session_id: "x", cwd: path.join(dir, "project") },
			[],
			{ CLAUDE_PROJECT_DIR: undefined }
		);

		expect(reply?.decision).toBe("block");
	});

	it("should find the config above the folder the agent runs in", () => {
		write("src/sub/Buy@sever.luau");

		const { reply } = stop(
			{ session_id: "x", cwd: path.join(dir, "project/src/sub") },
			[],
			{ CLAUDE_PROJECT_DIR: undefined }
		);

		expect(reply?.decision).toBe("block");
	});

	it("should not count a report as given when the reply could not be made", () => {
		write("src/Buy@sever.luau");
		const broken = path.join(dir, "broken");
		fs.mkdirSync(broken);
		const realJq = execFileSync("which", ["jq"], {
			encoding: "utf8",
		}).trim();
		fs.writeFileSync(
			path.join(broken, "jq"),
			`#!/bin/sh\n[ "$1" = "-n" ] && exit 1\nexec "${realJq}" "$@"\n`
		);
		fs.chmodSync(path.join(broken, "jq"), 0o755);

		const failed = stop({ session_id: "s" }, [], {
			PATH: `${broken}${path.delimiter}${bin}${path.delimiter}${process.env.PATH}`,
		});

		expect(failed.exit).toBe(1);
		expect(stop({ session_id: "s" }).reply?.decision).toBe("block");
	});

	it("should do nothing without a config in the project dir", () => {
		fs.rmSync(path.join(dir, "project/default.rogen.json"));
		fs.rmSync(path.join(dir, "project/lobby.rogen.json"));
		write("src/Buy@sever.luau");

		expect(stop()).toMatchObject({ exit: 0, reply: undefined });
	});
});
