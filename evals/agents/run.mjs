// Runs coding agents on Rogen tasks, with and without Rogen's agent rules, and scores what they leave behind. See README.md.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { score } from "./score.mjs";

const HERE = import.meta.dirname;
const ROGEN = path.resolve(HERE, "../../dist/bundle.cjs");
const TASKS = JSON.parse(
	fs.readFileSync(path.join(HERE, "tasks.json"), "utf8")
);
const CONDITIONS = {
	none: "no agent rules",
	agents: "the rules in AGENTS.md, as init writes them",
	claude: "the rules in AGENTS.md, imported by CLAUDE.md",
	fallback: 'the rules, and a "*" fallback route',
};

const { values } = parseArgs({
	options: {
		tasks: { type: "string", default: Object.keys(TASKS).join(",") },
		conditions: { type: "string", default: "none,agents" },
		layouts: { type: "string", default: "folder,suffix" },
		reps: { type: "string", default: "2" },
		model: { type: "string", default: "sonnet" },
		jobs: { type: "string", default: "4" },
		out: { type: "string" },
	},
});
const list = (value) => value.split(",").filter(Boolean);

if (!fs.existsSync(ROGEN)) {
	console.error("No dist/bundle.cjs: run 'npm run bundle' first.");
	process.exit(2);
}

const out = path.resolve(
	values.out ?? fs.mkdtempSync(path.join(os.tmpdir(), "rogen-eval-"))
);
fs.mkdirSync(out, { recursive: true });
const bin = path.join(out, "bin");
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(
	path.join(bin, "rogen"),
	`#!/bin/sh\nexec "${process.execPath}" "${ROGEN}" "$@"\n`,
	{ mode: 0o755 }
);

// An empty Claude Code config, so the user's own CLAUDE.md, skills, hooks and memory stay out of the runs.
const config = path.join(out, "claude-config");
fs.mkdirSync(config, { recursive: true });
const credentials = path.join(os.homedir(), ".claude", ".credentials.json");
if (fs.existsSync(credentials))
	fs.copyFileSync(credentials, path.join(config, ".credentials.json"));
else if (!process.env.ANTHROPIC_API_KEY) {
	console.error(
		"No ~/.claude/.credentials.json to copy: set ANTHROPIC_API_KEY."
	);
	process.exit(2);
}
const env = {
	...process.env,
	PATH: `${bin}${path.delimiter}${process.env.PATH}`,
	CLAUDE_CONFIG_DIR: config,
};

const rogen = (cwd, ...args) =>
	execFileSync(process.execPath, [ROGEN, ...args], { cwd, encoding: "utf8" });
const git = (cwd, ...args) =>
	execFileSync(
		"git",
		["-c", "user.email=eval@rogen", "-c", "user.name=eval", ...args],
		{ cwd, encoding: "utf8" }
	);
const editJson = (file, edit) => {
	const json = JSON.parse(fs.readFileSync(file, "utf8"));
	edit(json);
	fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
};

/** A fresh one-place Luau project from `rogen init`; `suffix` renames its Greeter to route by name instead of by folder. */
function fixture(layout) {
	const dir = path.join(out, `fixture-${layout}`);
	if (fs.existsSync(dir)) return dir;
	rogen(
		out,
		"init",
		path.basename(dir),
		"--language",
		"luau",
		"--no-agent-hook",
		"-y",
		"-q"
	);
	if (layout === "suffix") {
		const feature = path.join(dir, "src/Greeter");
		const read = (file) =>
			fs.readFileSync(path.join(feature, file), "utf8");
		const files = {
			"Greeting@shared.luau": read("Shared/Greeting.luau"),
			"Greeter.server.luau": read("Server/Greeter.server.luau"),
			"Greeter.client.luau": read("Client/Greeter.client.luau"),
		};
		fs.rmSync(feature, { recursive: true });
		fs.mkdirSync(feature);
		for (const [file, text] of Object.entries(files))
			fs.writeFileSync(path.join(feature, file), text);
		editJson(path.join(dir, "default.rogen.json"), (json) => {
			json.rogen.routes = {
				server: "ServerScriptService",
				client: "StarterPlayer/StarterPlayerScripts",
				shared: "ReplicatedStorage/Shared",
			};
		});
		fs.writeFileSync(
			path.join(dir, "README.md"),
			fs
				.readFileSync(path.join(dir, "README.md"), "utf8")
				.replace(
					/The folders inside it decide[^\n]*/,
					"The name of each file decides where it runs: `.server` and `@server` go to ServerScriptService, `.client` and `@client` to StarterPlayerScripts and `@shared` to ReplicatedStorage. To see where a file lands, and how to require it, use:"
				)
				.replaceAll(
					"src/Greeter/Shared/Greeting.luau",
					"src/Greeter/Greeting@shared.luau"
				)
		);
		rogen(dir, "write", "-q");
	}
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "fixture");
	return dir;
}

function prepare(layout, condition, dir) {
	fs.cpSync(fixture(layout), dir, { recursive: true });
	if (condition === "none") git(dir, "rm", "-q", "AGENTS.md");
	if (condition === "claude")
		fs.writeFileSync(path.join(dir, "CLAUDE.md"), "@AGENTS.md\n");
	if (condition === "fallback") {
		editJson(path.join(dir, "default.rogen.json"), (json) => {
			json.rogen.routes["*"] = "ReplicatedStorage/Shared";
		});
		rogen(dir, "write", "-q");
	}
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", condition, "--allow-empty");
}

function agent(dir, prompt, transcript) {
	return new Promise((resolve) => {
		const child = spawn(
			"claude",
			[
				"-p",
				`${prompt} Do not commit.`,
				"--model",
				values.model,
				"--output-format",
				"stream-json",
				"--verbose",
				"--permission-mode",
				"bypassPermissions",
				"--max-turns",
				"40",
			],
			{
				cwd: dir,
				env,
				stdio: ["ignore", fs.openSync(transcript, "w"), "ignore"],
			}
		);
		const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
		child.on("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

const runs = list(values.layouts).flatMap((layout) =>
	list(values.tasks).flatMap((task) =>
		list(values.conditions).flatMap((condition) =>
			Array.from({ length: Number(values.reps) }, (_, index) => ({
				layout,
				task,
				condition,
				rep: index + 1,
			}))
		)
	)
);
for (const { task, condition } of runs) {
	if (!TASKS[task]) throw new Error(`No task ${task} in tasks.json.`);
	if (!CONDITIONS[condition])
		throw new Error(
			`No condition ${condition}: ${Object.keys(CONDITIONS).join(", ")}.`
		);
}
for (const layout of list(values.layouts)) fixture(layout);
console.error(`${runs.length} runs with ${values.model} into ${out}`);

const results = [];
const queue = [...runs];
await Promise.all(
	Array.from({ length: Number(values.jobs) }, async () => {
		for (let next = queue.shift(); next; next = queue.shift()) {
			const name = `${next.layout}-${next.task}-${next.condition}-${next.rep}`;
			const dir = path.join(out, "runs", name);
			prepare(next.layout, next.condition, dir);
			await agent(dir, TASKS[next.task], `${dir}.jsonl`);
			const scored = { ...next, ...score(dir, `${dir}.jsonl`, ROGEN) };
			results.push(scored);
			console.error(`${scored.passed ? "pass" : "FAIL"} ${name}`);
		}
	})
);

const rogenVersion = spawnSync(process.execPath, [ROGEN, "--version"], {
	encoding: "utf8",
}).stdout.trim();
fs.writeFileSync(
	path.join(out, "results.json"),
	`${JSON.stringify({ model: values.model, rogen: rogenVersion, date: new Date().toISOString().slice(0, 10), results }, null, "\t")}\n`
);

const rows = new Map();
for (const result of results) {
	const key = `| ${result.layout} | ${result.task} | ${result.condition} |`;
	const row = rows.get(key) ?? { passed: 0, runs: 0, stale: 0, cost: 0 };
	row.runs += 1;
	row.passed += result.passed ? 1 : 0;
	row.stale += result.fresh ? 0 : 1;
	row.cost += result.cost ?? 0;
	rows.set(key, row);
}
console.log(
	`${rogenVersion}, ${values.model}, ${results.length} runs, $${results.reduce((sum, { cost }) => sum + (cost ?? 0), 0).toFixed(2)}\n`
);
console.log(
	"| Layout | Task | Condition | Passed | Stale project file |\n|---|---|---|---|---|"
);
for (const [key, row] of [...rows].sort())
	console.log(`${key} ${row.passed}/${row.runs} | ${row.stale} |`);
console.log(`\nResults and transcripts: ${out}`);
