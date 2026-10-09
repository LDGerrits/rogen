import { execFileSync, spawnSync } from "child_process";
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

/** Narrows a replaced line to the words that differ, keeping a little around them. */
function editOf(
	removed: string,
	added: string
): Omit<TranscriptChange, "cases"> {
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

	const dropped = from.slice(start, from.length - end).join("");
	const gained = to.slice(start, to.length - end).join("");
	// Only the spacing changed.
	if (!dropped && !gained) return { before: "", removed, added, after: "" };

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
		if (removed.length === added.length) {
			removed.forEach((line, at) => {
				add(editOf(line, added[at] ?? ""));
			});
		} else {
			for (const line of removed)
				add({ before: "", removed: line, added: "", after: "" });
			for (const line of added)
				add({ before: "", removed: "", added: line, after: "" });
		}
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

export function formatSummary(
	changes: readonly TranscriptChange[],
	added: readonly string[]
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

	return parts.length > 0 ? parts.join("\n\n") : "No transcript changed.";
}

const git = (...args: string[]): string =>
	execFileSync("git", args, {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	let status = 0;
	if (process.argv.includes("--update")) {
		status =
			spawnSync(
				process.execPath,
				[
					"--experimental-vm-modules",
					"--disable-warning=ExperimentalWarning",
					path.join("node_modules", "jest", "bin", "jest.js"),
					"--roots",
					"e2e",
				],
				{ stdio: "inherit", env: { ...process.env, UPDATE_E2E: "1" } }
			).status ?? 1;
	}

	const added = git("ls-files", "--others", "--exclude-standard", CASES_DIR)
		.split("\n")
		.filter((file) => file.endsWith(`/${TRANSCRIPT}`))
		.map(nameOf);
	console.log(
		formatSummary(
			summarizeTranscriptDiff(
				git("diff", "-U0", "--no-color", "--", CASES_DIR)
			),
			added
		)
	);
	process.exit(status);
}
