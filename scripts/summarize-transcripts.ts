import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

/**
 * Sums up how the e2e transcripts differ from the last commit, as the distinct edits and how many transcripts each is in.
 *
 *   node scripts/summarize-transcripts.ts [--update]
 *
 * With `--update` it regenerates the transcripts first. A wording change that touches dozens of them then reads as a line or two, and an edit that only a few transcripts have stands out.
 */

const CASES_DIR = "e2e/cases";
const TRANSCRIPT = "expected.txt";
/** An edit in this many transcripts or fewer is listed with them. */
const NAMED_UP_TO = 3;
/** Words kept on each side of an edit, so it reads on its own. */
const CONTEXT_WORDS = 2;

/** One edit to a line: `removed` became `added` between `before` and `after`. A line that appears or disappears whole has only one of the two. */
export interface TranscriptChange {
	readonly before: string;
	readonly removed: string;
	readonly added: string;
	readonly after: string;
	/** The transcripts it is in, as `<area>/<case>`. */
	readonly cases: readonly string[];
}

const nameOf = (file: string): string => {
	const relative = file.slice(`${CASES_DIR}/`.length);
	return relative.endsWith(`/${TRANSCRIPT}`)
		? relative.slice(0, -`/${TRANSCRIPT}`.length)
		: relative;
};

/** The words and the spaces between them, so that joining them gives the line back. */
const tokens = (line: string) => line.trim().split(/(\s+)/);

/** The last `words` words of `parts`, with the space before them. */
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

/** Narrows a replaced line to the words that differ, keeping a little around them. None when the two lines share too little to be one line edited. */
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
	// Only the spacing changed.
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

/** Reads a `git diff -U0` of the cases folder. The edit in the most transcripts comes first. */
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

/** Transcripts and case files that exist only on one side of the diff, as `<area>/<case>`. */
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

/** Runs the e2e suite so that it rewrites the transcripts. The exit code is non-zero when it fails or when Rojo is missing and it skipped every case. */
function regenerate(): number {
	const report = path.join(os.tmpdir(), `rogen-e2e-${process.pid}.json`);
	const status =
		spawnSync(
			process.execPath,
			[
				"--experimental-vm-modules",
				"--disable-warning=ExperimentalWarning",
				path.join("node_modules", "jest", "bin", "jest.js"),
				"--roots",
				"e2e",
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

/** What differs from the last commit, staged or not. */
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
