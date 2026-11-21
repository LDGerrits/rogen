import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const CASES_DIR = "e2e/cases";
const TRANSCRIPT = "expected.txt";
const NAMED_UP_TO = 3;
const CONTEXT_WORDS = 2;

export interface TranscriptChange {
	readonly before: string;
	readonly removed: string;
	readonly added: string;
	readonly after: string;
	readonly cases: readonly string[];
}

const nameOf = (file: string): string => {
	const relative = file.slice(`${CASES_DIR}/`.length);
	return relative.endsWith(`/${TRANSCRIPT}`)
		? relative.slice(0, -`/${TRANSCRIPT}`.length)
		: relative;
};

const tokens = (line: string) => line.trim().split(/(\s+)/);

const lastWords = (parts: string[], words: number) =>
	parts.slice(-(2 * words)).join("");

const BLANK = "(blank line)";

const wholeLine = (line: string) => line || BLANK;

const whole = (
	side: "removed" | "added",
	line: string
): Omit<TranscriptChange, "cases"> => ({
	before: "",
	removed: "",
	added: "",
	after: "",
	[side]: wholeLine(line),
});

const words = (parts: readonly string[]) =>
	parts.filter((part) => part.trim() !== "").length;

function editOf(
	removed: string,
	added: string
): Omit<TranscriptChange, "cases"> | undefined {
	const from = tokens(removed);
	const to = tokens(added);

	let start = 0;
	while (
		start < from.length &&
		start < to.length &&
		from[start] === to[start]
	)
		start++;
	let end = 0;
	while (
		end < from.length - start &&
		end < to.length - start &&
		from[from.length - 1 - end] === to[to.length - 1 - end]
	)
		end++;

	const shared =
		words(from.slice(0, start)) + words(from.slice(from.length - end));
	if (shared * 2 < Math.min(words(from), words(to))) return undefined;

	const dropped = from.slice(start, from.length - end).join("");
	const gained = to.slice(start, to.length - end).join("");
	if (!dropped && !gained)
		return {
			before: "",
			removed: wholeLine(removed),
			added: wholeLine(added),
			after: "",
		};

	return {
		before: lastWords(from.slice(0, start), CONTEXT_WORDS),
		removed: dropped,
		added: gained,
		after: from
			.slice(from.length - end)
			.slice(0, 2 * CONTEXT_WORDS)
			.join(""),
	};
}

export function summarizeTranscriptDiff(diff: string): TranscriptChange[] {
	const edits = new Map<
		string,
		{ edit: Omit<TranscriptChange, "cases">; cases: Set<string> }
	>();
	let current = "";
	let inHunk = false;
	let removed: string[] = [];
	let added: string[] = [];

	const add = (edit: Omit<TranscriptChange, "cases">) => {
		const key = JSON.stringify(edit);
		const known = edits.get(key) ?? { edit, cases: new Set<string>() };
		known.cases.add(current);
		edits.set(key, known);
	};
	const endHunk = () => {
		const paired = removed.length === added.length;
		const edited = new Set<number>();
		removed.forEach((line, at) => {
			const edit = paired ? editOf(line, added[at] ?? "") : undefined;
			if (edit) edited.add(at);
			add(edit ?? whole("removed", line));
		});
		added.forEach((line, at) => {
			if (!edited.has(at)) add(whole("added", line));
		});
		removed = [];
		added = [];
	};

	for (const text of diff.split("\n")) {
		if (text.startsWith("diff --git ")) {
			endHunk();
			inHunk = false;
			current = nameOf(text.slice(text.lastIndexOf(" b/") + 3));
		} else if (text.startsWith("@@")) {
			endHunk();
			inHunk = true;
		} else if (inHunk && text[0] === "-") {
			removed.push(text.slice(1));
		} else if (inHunk && text[0] === "+") {
			added.push(text.slice(1));
		}
	}
	endHunk();

	return [...edits.values()]
		.map(({ edit, cases }) => ({ ...edit, cases: [...cases] }))
		.sort((a, b) => b.cases.length - a.cases.length);
}

const show = (change: TranscriptChange): string => {
	if (!change.removed) return `+ ${change.added}`;
	if (!change.added) return `- ${change.removed}`;
	return `${change.before}[-${change.removed}-]{+${change.added}+}${change.after}`;
};

const plural = (count: number, noun: string) =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

export interface TranscriptFiles {
	readonly added: readonly string[];
	readonly deleted: readonly string[];
}

export function formatSummary(
	changes: readonly TranscriptChange[],
	{ added, deleted }: TranscriptFiles
): string {
	const changed = new Set(changes.flatMap((change) => change.cases));
	const parts: string[] = [];

	if (changes.length > 0) {
		const width = String(changes[0]?.cases.length).length;
		const rows = changes.flatMap((change) => {
			const count = String(change.cases.length).padStart(width);
			const row = `  ${count}×  ${show(change)}`;
			return change.cases.length <= NAMED_UP_TO
				? [
						row,
						`  ${" ".repeat(width)}   in ${change.cases.join(", ")}`,
					]
				: [row];
		});
		parts.push(
			`${plural(changed.size, "transcript")} changed, ${plural(changes.length, "distinct change")}.\n\n${rows.join("\n")}`
		);
	}
	if (added.length > 0)
		parts.push(
			`${plural(added.length, "new transcript")}: ${added.join(", ")}`
		);
	if (deleted.length > 0)
		parts.push(
			`${plural(deleted.length, "deleted transcript")}: ${deleted.join(", ")}`
		);

	return parts.length > 0 ? parts.join("\n\n") : "No transcript changed.";
}

const ROOT = path.resolve(import.meta.dirname, "..");

const git = (...args: string[]): string =>
	execFileSync("git", args, {
		cwd: ROOT,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});

function regenerate(): number {
	const report = path.join(os.tmpdir(), `rogen-e2e-${process.pid}.json`);
	const status =
		spawnSync(
			process.execPath,
			[
				"--experimental-vm-modules",
				"--disable-warning=ExperimentalWarning",
				path.join("node_modules", "jest", "bin", "jest.js"),
				"--config",
				"jest.e2e.config.js",
				"--json",
				`--outputFile=${report}`,
			],
			{
				cwd: ROOT,
				stdio: "inherit",
				env: { ...process.env, UPDATE_E2E: "1" },
			}
		).status ?? 1;

	try {
		const { numPendingTests } = JSON.parse(
			fs.readFileSync(report, "utf8")
		) as { numPendingTests: number };
		if (numPendingTests > 0) {
			console.error(
				`${plural(numPendingTests, "test")} skipped, so the transcripts were not regenerated. Run \`rokit install\` first.`
			);
			return status || 1;
		}
	} catch {
		return status || 1;
	} finally {
		fs.rmSync(report, { force: true });
	}
	return status;
}

function changesSinceCommit(): { diff: string; files: TranscriptFiles } {
	const named = (filter: string) =>
		git(
			"diff",
			"HEAD",
			`--diff-filter=${filter}`,
			"--name-only",
			"--",
			CASES_DIR
		)
			.split("\n")
			.filter((file) => file.endsWith(`/${TRANSCRIPT}`))
			.map(nameOf);
	const untracked = git(
		"ls-files",
		"--others",
		"--exclude-standard",
		CASES_DIR
	)
		.split("\n")
		.filter((file) => file.endsWith(`/${TRANSCRIPT}`))
		.map(nameOf);

	return {
		diff: git(
			"diff",
			"HEAD",
			"-U0",
			"--no-color",
			"--diff-filter=M",
			"--",
			CASES_DIR
		),
		files: { added: [...named("A"), ...untracked], deleted: named("D") },
	};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const status = process.argv.includes("--update") ? regenerate() : 0;
	const { diff, files } = changesSinceCommit();
	console.log(formatSummary(summarizeTranscriptDiff(diff), files));
	process.exit(status);
}
