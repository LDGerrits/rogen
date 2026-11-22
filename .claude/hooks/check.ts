// Claude Code's Stop hook: when files changed, run the linter, the type checks and the unit tests the
// changes touch, and hand a failure back to the agent before it ends its turn. If the agent already
// had its chance in this stop, it may stop, so the hook can't loop, and the user is told the check
// fails. The end-to-end cases and the coverage gate are too slow for every stop: `npm run check` runs
// them before a pull request.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

let payload: { cwd?: string; stop_hook_active?: boolean } = {};
try {
	payload = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
	// No payload: check the folder the hook runs in.
}

// The session's own checkout, from its folder: in a worktree session, CLAUDE_PROJECT_DIR can name the
// main one.
const git = (...args: string[]) => {
	const run = spawnSync("git", ["-C", payload.cwd ?? ".", ...args], {
		encoding: "utf8",
	});
	return run.status === 0 ? run.stdout : "";
};
const root = git("rev-parse", "--show-toplevel").trim();
if (root === "") process.exit(0);
process.chdir(root);

const changed = [
	...git("diff", "-z", "--name-only", "HEAD").split("\0"),
	...git("ls-files", "-z", "--others", "--exclude-standard").split("\0"),
].filter((file) => file !== "");
if (changed.length === 0) process.exit(0);

const npm = (args: string[]) =>
	new Promise<{ command: string; ok: boolean; output: string }>((resolve) => {
		const command = `npm ${args.join(" ")}`;
		const child = spawn("npm", args, {
			shell: process.platform === "win32",
		});
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		child.on("error", (error) =>
			resolve({ command, ok: true, output: error.message })
		);
		child.on("close", (code) =>
			resolve({ command, ok: code === 0, output: output.trim() })
		);
	});

// Generate once, then skip each script's own `pre` step, so the steps don't write the generated files
// at the same time.
const steps = [
	["run", "--silent", "--ignore-scripts", "lint"],
	["exec", "--no", "--", "tsc", "--noEmit"],
	["run", "--silent", "--ignore-scripts", "typecheck"],
	["run", "--silent", "--ignore-scripts", "test:changed"],
];
const generate = await npm(["run", "--silent", "generate"]);
const results = generate.ok ? await Promise.all(steps.map(npm)) : [generate];
const failed = results.filter((result) => !result.ok);
if (failed.length === 0) process.exit(0);

const output = failed
	.map((result) => `$ ${result.command}\n${result.output.slice(-3000)}`)
	.join("\n\n");
const commands = failed.map((result) => `\`${result.command}\``).join(", ");
if (payload.stop_hook_active === true) {
	console.log(
		JSON.stringify({
			systemMessage: `The agent stopped, but ${commands} still fails:\n${output}`,
		})
	);
} else {
	const reason = `${commands} fails after your changes. Fix it, or tell the user why it stays failing:\n${output}`;
	console.log(JSON.stringify({ decision: "block", reason }));
}
