import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { score, scorePlaces } from "./score.mjs";

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
	short: "five lines of rules in AGENTS.md, without markers so no write replaces them",
	proposed: "a shorter block of rules in AGENTS.md, without markers",
};
const SHORT_RULES = `## Rogen

- A file's path on disk is not its path in the game. Run \`rogen where <path>\`.
- The outermost route wins, so keep server code under a server route.
- Edit the \`*.rogen.json\`, never the \`*.project.json\`.
- After adding, moving or deleting files, run \`rogen check\`.
- For anything else, run \`rogen doc <topic>\`.
`;
const PROPOSED_RULES = `## Rogen

This repo uses Rogen: each \`*.rogen.json\` generates the \`*.project.json\` beside it from folder and file names.

- A file's path on disk is not its path in the game. Run \`rogen where <path>\` to see where it lands and how to require it.
- The outermost route wins, so \`shared/server/save.luau\` ships to clients. Keep server-only code under a server route.
- After you add, move or delete files, run \`rogen check <paths>\` and fix what it prints.
- Edit the \`*.rogen.json\`, never the \`*.project.json\`. Packages go in its \`tree\`, and a change to \`routes\` goes in every \`*.rogen.json\` it concerns.
- To sync to Studio, use the repo's serve script, or run \`rogen serve --json\` in the background.
- For anything else, run \`rogen doc <topic>\` or \`rogen help <command> --json\`.
`;
const LUAU_LAYOUTS = ["folder", "suffix"];
const promptOf = (task) =>
	typeof TASKS[task] === "string" ? TASKS[task] : TASKS[task].prompt;
const runsIn = (task, layout) =>
	typeof TASKS[task] === "string"
		? LUAU_LAYOUTS.includes(layout)
		: TASKS[task].layout === layout;

const { values } = parseArgs({
	options: {
		tasks: { type: "string", default: Object.keys(TASKS).join(",") },
		conditions: { type: "string", default: "none,agents" },
		layouts: { type: "string", default: "folder,suffix,rbxts" },
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

// An empty Claude Code config, so the user's own CLAUDE.md, skills, hooks and
// memory stay out of the runs.
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

function fixture(layout) {
	const dir = path.join(out, `fixture-${layout}`);
	if (fs.existsSync(dir)) return dir;
	if (layout === "rbxts") return placesFixture(dir);
	rogen(out, "init", path.basename(dir), "--language", "luau", "-y", "-q");
	if (layout === "suffix") {
		const feature = path.join(dir, "src/greeter");
		const read = (file) =>
			fs.readFileSync(path.join(feature, file), "utf8");
		const files = {
			"greeting@shared.luau": read("shared/greeting.luau"),
			"greeter.server.luau": read("server/greeter.server.luau"),
			"greeter.client.luau": read("client/greeter.client.luau"),
		};
		fs.rmSync(feature, { recursive: true });
		fs.mkdirSync(feature);
		for (const [file, text] of Object.entries(files))
			fs.writeFileSync(path.join(feature, file), text);
		editJson(path.join(dir, "default.rogen.json"), (json) => {
			json.routes = {
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
					"src/greeter/shared/greeting.luau",
					"src/greeter/greeting@shared.luau"
				)
		);
		rogen(dir, "write", "-q");
	}
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "fixture");
	return dir;
}

function placesFixture(dir) {
	fs.mkdirSync(dir);
	rogen(dir, "init", ".", "--places", "--language", "roblox-ts", "-y", "-q");
	const game = path.join(dir, "projects/game");
	const lobby = path.join(dir, "projects/lobby");
	fs.cpSync(game, lobby, {
		recursive: true,
		filter: (source) => !["out", "include"].includes(path.basename(source)),
	});
	fs.renameSync(path.join(lobby, "src/Game"), path.join(lobby, "src/Lobby"));
	fs.renameSync(
		path.join(lobby, "src/Lobby/server/Game.server.ts"),
		path.join(lobby, "src/Lobby/server/Lobby.server.ts")
	);
	fs.writeFileSync(
		path.join(lobby, "src/Lobby/server/Lobby.server.ts"),
		fs
			.readFileSync(
				path.join(lobby, "src/Lobby/server/Lobby.server.ts"),
				"utf8"
			)
			.replace('"game"', '"lobby"')
	);
	editJson(path.join(lobby, "default.rogen.json"), (json) => {
		json.name = "lobby";
	});
	rogen(dir, "write", "projects/lobby", "-q");
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "fixture");
	return dir;
}

function prepare(layout, condition, dir) {
	fs.cpSync(fixture(layout), dir, {
		recursive: true,
		filter: (source) => path.basename(source) !== "node_modules",
	});
	const modules = path.join(fixture(layout), "node_modules");
	if (fs.existsSync(modules))
		fs.symlinkSync(modules, path.join(dir, "node_modules"));
	if (condition === "none") git(dir, "rm", "-q", "AGENTS.md");
	if (condition === "short")
		fs.writeFileSync(path.join(dir, "AGENTS.md"), SHORT_RULES);
	if (condition === "proposed")
		fs.writeFileSync(path.join(dir, "AGENTS.md"), PROPOSED_RULES);
	if (condition === "claude")
		fs.writeFileSync(path.join(dir, "CLAUDE.md"), "@AGENTS.md\n");
	if (condition === "fallback") {
		editJson(path.join(dir, "default.rogen.json"), (json) => {
			json.routes["*"] = "ReplicatedStorage/Shared";
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
	list(values.tasks)
		.filter((task) => TASKS[task] && runsIn(task, layout))
		.flatMap((task) =>
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
for (const task of list(values.tasks))
	if (!TASKS[task]) throw new Error(`No task ${task} in tasks.json.`);
for (const { condition } of runs) {
	if (!CONDITIONS[condition])
		throw new Error(
			`No condition ${condition}: ${Object.keys(CONDITIONS).join(", ")}.`
		);
}
for (const layout of new Set(runs.map(({ layout }) => layout))) fixture(layout);
console.error(`${runs.length} runs with ${values.model} into ${out}`);

const results = [];
const queue = [...runs];
await Promise.all(
	Array.from({ length: Number(values.jobs) }, async () => {
		for (let next = queue.shift(); next; next = queue.shift()) {
			const name = `${next.layout}-${next.task}-${next.condition}-${next.rep}`;
			const dir = path.join(out, "runs", name);
			prepare(next.layout, next.condition, dir);
			await agent(dir, promptOf(next.task), `${dir}.jsonl`);
			const scored = {
				...next,
				...(next.layout === "rbxts"
					? scorePlaces(
							dir,
							`${dir}.jsonl`,
							ROGEN,
							TASKS[next.task].lands
						)
					: score(dir, `${dir}.jsonl`, ROGEN)),
			};
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
