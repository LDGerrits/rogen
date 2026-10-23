// Scores one finished run: whether it checks clean, whether the project file is current, whether every require resolves, where new files landed, and which Rogen commands the agent ran.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function score(dir, transcript, rogen) {
	const run = (args, cwd = dir) =>
		spawnSync(process.execPath, [rogen, ...args], {
			cwd,
			encoding: "utf8",
		});
	const git = (...args) =>
		execFileSync("git", args, { cwd: dir, encoding: "utf8" });

	const events = fs
		.readFileSync(transcript, "utf8")
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});
	const commands = [];
	const edited = new Set();
	let result = {};
	for (const event of events) {
		if (event.type === "result")
			result = {
				turns: event.num_turns,
				cost: event.total_cost_usd,
				outcome: event.subtype,
			};
		for (const part of event.message?.content ?? []) {
			if (part.type !== "tool_use") continue;
			if (part.name === "Bash") commands.push(part.input.command);
			if (part.name === "Write" || part.name === "Edit")
				edited.add(path.relative(dir, part.input.file_path));
		}
	}

	const check = run(["check"]);
	const copy = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-eval-fresh-"));
	fs.cpSync(dir, copy, { recursive: true });
	run(["write", "-q"], copy);
	const projectFile = "default.project.json";
	const fresh =
		fs.readFileSync(path.join(dir, projectFile), "utf8") ===
		fs.readFileSync(path.join(copy, projectFile), "utf8");
	fs.rmSync(copy, { recursive: true, force: true });

	const files = git(
		"ls-files",
		"--cached",
		"--others",
		"--exclude-standard",
		"src"
	)
		.split("\n")
		.filter((file) => file.endsWith(".luau"));
	const where = JSON.parse(run(["where", "--json", ...files]).stdout || "{}");
	const instanceOf = {};
	for (const location of where.locations ?? [])
		if (location.instancePath)
			instanceOf[
				path.relative(dir, location.source).replaceAll("\\", "/")
			] = location.instancePath.join(".");
	const instances = new Set(Object.values(instanceOf));

	const unresolved = [];
	for (const file of files) {
		const text = fs.readFileSync(path.join(dir, file), "utf8");
		const services = Object.fromEntries(
			[
				...text.matchAll(
					/local\s+(\w+)\s*=\s*game:GetService\("(\w+)"\)/g
				),
			].map((m) => [m[1], m[2]])
		);
		const self = instanceOf[file]?.split(".") ?? [];
		for (const [, inside] of text.matchAll(
			/require\(((?:[^()]|\([^()]*\))*)\)/g
		)) {
			let expression = inside
				.trim()
				.replace(/game:GetService\("(\w+)"\)/, "$1");
			const head = expression.split(".")[0];
			if (services[head])
				expression = services[head] + expression.slice(head.length);
			let target = expression;
			if (expression.startsWith("script")) {
				const at = [...self];
				for (const step of expression.split(".").slice(1))
					if (step === "Parent") at.pop();
					else at.push(step);
				target = at.join(".");
			}
			if (!instances.has(target))
				unresolved.push(`${file}: require(${inside})`);
		}
	}

	const changed = git("status", "--porcelain", "--untracked-files=all", "src")
		.split("\n")
		.filter(Boolean)
		.map((line) => line.slice(3).split(" -> ").at(-1));
	const placed = Object.fromEntries(
		changed.map((file) => [file, instanceOf[file] ?? null])
	);
	const rogenCommands = [
		...new Set(
			commands.flatMap((command) =>
				[...command.matchAll(/rogen\s+([a-z][\w-]*)/g)].map((m) => m[1])
			)
		),
	];

	return {
		...result,
		checkExit: check.status,
		checkOutput: (check.stdout + check.stderr).trim(),
		fresh,
		editedProjectFile: edited.has(projectFile),
		unresolved,
		placed,
		rogenCommands,
		passed:
			check.status === 0 &&
			fresh &&
			unresolved.length === 0 &&
			!edited.has(projectFile),
	};
}
