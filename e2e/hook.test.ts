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
		/```js title="\.agents\/hooks\/rogen-check\.mjs"\n([\s\S]*?)\n```/
	)?.[1];

const gitPath = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
const available = gitPath !== "";

(available ? describe : describe.skip)("agent Stop hook", () => {
	let bundle: ReturnType<typeof bundleCli>;
	let dir: string;
	let bin: string;
	let gitOnly: string;

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
			process.execPath,
			[path.join(dir, "rogen-check.mjs"), ...args],
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

	const wrapRogen = (wrapper: string) => {
		const [command, args] = invocation(bundle.cli, []);
		fs.mkdirSync(path.dirname(wrapper), { recursive: true });
		fs.writeFileSync(
			wrapper,
			`#!/bin/sh\nexec "${command}" ${args.map((arg) => `"${arg}"`).join(" ")} "$@"\n`
		);
		fs.chmodSync(wrapper, 0o755);
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
		fs.writeFileSync(path.join(dir, "rogen-check.mjs"), script!);
		wrapRogen(path.join(bin, "rogen"));
		gitOnly = path.join(dir, "git-only");
		fs.mkdirSync(gitOnly);
		fs.symlinkSync(gitPath, path.join(gitOnly, "git"));

		fs.mkdirSync(path.join(dir, "project"));
		execFileSync("git", ["init", "-q"], {
			cwd: path.join(dir, "project"),
		});
		write(
			"default.rogen.json",
			JSON.stringify({
				sourcePaths: ["src"],
				routes: {
					Server: "ServerScriptService",
					Shared: "ReplicatedStorage/Shared",
					"*": "ReplicatedStorage/Shared",
				},
			})
		);
		write(".gitignore", "node_modules\n");
		write("src/Old@sevre.luau");
		write("src/Save.luau");
		git("add", "-A");
		git("commit", "-qm", "init");
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("should be in the agents docs", () => {
		expect(script).toBeDefined();
	});

	it("should say nothing about a clean file, or the warning that was there before", () => {
		write("src/Clean.luau");

		expect(stop()).toMatchObject({ exit: 0, reply: undefined });
	});

	it("should block nothing for a changed file that no build reads", () => {
		write("README.md", "# Project\n");
		write("lib/x.luau");

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

	it("should report a warning in the shared code of root-level places once", () => {
		fs.rmSync(path.join(dir, "project/default.rogen.json"));
		for (const place of ["game", "lobby"])
			write(
				`${place}.rogen.json`,
				JSON.stringify({
					name: place,
					sourcePaths: ["src/common", `src/${place}`],
					routes: {
						Server: "ServerScriptService",
						"*": "ReplicatedStorage/Shared",
					},
				})
			);
		git("add", "-A");
		git("commit", "-qm", "places");

		write("src/common/Buy@sever.luau");
		const { reply, report } = stop();

		expect(reply?.decision).toBe("block");
		expect(report).toEqual([
			expect.stringMatching(
				/^src\/common\/Buy@sever\.luau - warning: .*\(route\.strayAt\)$/
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

	it("should check a changed file from a folder below the config, which its path finds", () => {
		write("src/sub/Buy@sever.luau");

		const { reply } = stop(
			{ session_id: "x", cwd: path.join(dir, "project/src/sub") },
			[],
			{ CLAUDE_PROJECT_DIR: undefined }
		);

		expect(reply?.decision).toBe("block");
	});

	it("should answer for a changed file of a place from the repo root, and skip shared code that no config covers", () => {
		fs.rmSync(path.join(dir, "project/default.rogen.json"));
		fs.rmSync(path.join(dir, "project/src"), { recursive: true });
		const routes = {
			Server: "ServerScriptService",
			"*": "ReplicatedStorage/Shared",
		};
		write(
			"places/lobby/default.rogen.json",
			JSON.stringify({
				name: "Lobby",
				sourcePaths: ["../shared/src", "src"],
				routes,
			})
		);
		git("add", "-A");
		git("commit", "-qm", "places");
		write("places/lobby/src/Buy@sever.luau");
		write("places/shared/src/Stray@sever.luau");

		const { exit, reply, report } = stop();

		expect(exit).toBe(0);
		expect(reply?.decision).toBe("block");
		expect(report).toEqual([
			expect.stringMatching(
				/^places\/lobby\/src\/Buy@sever\.luau - warning: .*\(route\.strayAt\)$/
			),
		]);
	});

	it("should run the project's own rogen before the one on the PATH", () => {
		write("src/Buy@sever.luau");
		const stub = path.join(dir, "stub");
		fs.mkdirSync(stub);
		fs.writeFileSync(path.join(stub, "rogen"), "#!/bin/sh\necho wrong\n");
		fs.chmodSync(path.join(stub, "rogen"), 0o755);
		wrapRogen(path.join(dir, "project/node_modules/.bin/rogen"));

		const { report } = stop({ session_id: "s" }, [], {
			PATH: `${stub}${path.delimiter}${process.env.PATH}`,
		});

		expect(report).toEqual([expect.stringContaining("route.strayAt")]);
	});

	it("should run the project's rogen when none is on the PATH", () => {
		write("src/Buy@sever.luau");
		wrapRogen(path.join(dir, "project/node_modules/.bin/rogen"));

		const { reply } = stop({ session_id: "s" }, [], { PATH: gitOnly });

		expect(reply?.decision).toBe("block");
	});

	it("should say once per session that it found no rogen, and never block", () => {
		write("src/Buy@sever.luau");

		const first = stop({ session_id: "s" }, [], { PATH: gitOnly });
		const again = stop({ session_id: "s" }, [], { PATH: gitOnly });
		const other = stop({ session_id: "t" }, [], { PATH: gitOnly });

		expect(first).toMatchObject({ exit: 0, reply: undefined });
		expect(first.stderr).toBe(
			"Rogen's hook found no rogen; install it in the project or globally\n"
		);
		expect(again).toMatchObject({ exit: 0, reply: undefined, stderr: "" });
		expect(other.stderr).toBe(first.stderr);
	});

	it("should still report once rogen is installed after it said it found none", () => {
		write("src/Buy@sever.luau");
		stop({ session_id: "s" }, [], { PATH: gitOnly });

		expect(stop({ session_id: "s" }).reply?.decision).toBe("block");
	});

	it("should say nothing about a missing rogen when no file changed", () => {
		expect(stop({ session_id: "s" }, [], { PATH: gitOnly })).toMatchObject({
			exit: 0,
			stderr: "",
			reply: undefined,
		});
	});

	it("should do nothing without a config in the project dir", () => {
		fs.rmSync(path.join(dir, "project/default.rogen.json"));
		write("src/Buy@sever.luau");

		expect(stop()).toMatchObject({ exit: 0, reply: undefined });
	});
});
