import {
	formatSummary,
	summarizeTranscriptDiff,
	type TranscriptChange,
} from "../summarize-transcripts.js";

const hunk = (name: string, ...lines: string[]) =>
	[
		`diff --git a/e2e/cases/${name}/expected.txt b/e2e/cases/${name}/expected.txt`,
		"index 1111111..2222222 100644",
		`--- a/e2e/cases/${name}/expected.txt`,
		`+++ b/e2e/cases/${name}/expected.txt`,
		"@@ -3,2 +3,2 @@ stdout:",
		...lines,
	].join("\n");

const change = (
	patch: Partial<TranscriptChange> & { cases: readonly string[] }
): TranscriptChange => ({
	before: "",
	removed: "",
	added: "",
	after: "",
	...patch,
});

describe("scripts/summarize-transcripts", () => {
	describe("summarizeTranscriptDiff", () => {
		it("should reduce a replaced line to the words that changed", () => {
			const changes = summarizeTranscriptDiff(
				hunk(
					"init/a",
					'-  Declare variants under "variants" in lobby.json to swap',
					'+  Declare variants in "variants" in lobby.json to swap'
				)
			);

			expect(changes).toEqual([
				change({
					before: "Declare variants ",
					removed: "under",
					added: "in",
					after: ' "variants" in',
					cases: ["init/a"],
				}),
			]);
		});

		it("should group an edit across lines that differ beyond two words of it", () => {
			const changes = summarizeTranscriptDiff(
				[
					hunk(
						"init/a",
						"-a.json one two old three four",
						"+a.json one two new three four"
					),
					hunk(
						"init/b",
						"-b.json one two old three four",
						"+b.json one two new three four"
					),
				].join("\n")
			);

			expect(changes).toEqual([
				change({
					before: "one two ",
					removed: "old",
					added: "new",
					after: " three four",
					cases: ["init/a", "init/b"],
				}),
			]);
		});

		it("should report a line that appears or disappears whole", () => {
			const changes = summarizeTranscriptDiff(
				[
					hunk("x/a", "+new line"),
					hunk("x/b", "-old line", "-another", "+one"),
				].join("\n")
			);

			expect(changes).toEqual([
				change({ added: "new line", cases: ["x/a"] }),
				change({ removed: "old line", cases: ["x/b"] }),
				change({ removed: "another", cases: ["x/b"] }),
				change({ added: "one", cases: ["x/b"] }),
			]);
		});

		it("should count an edit once per transcript when it repeats there", () => {
			const changes = summarizeTranscriptDiff(
				hunk("init/a", "-a old b", "-a old b", "+a new b", "+a new b")
			);

			expect(changes).toEqual([
				change({
					before: "a ",
					removed: "old",
					added: "new",
					after: " b",
					cases: ["init/a"],
				}),
			]);
		});

		it("should group an edit that several transcripts share, and list it first", () => {
			const changes = summarizeTranscriptDiff(
				[
					hunk(
						"x/a",
						"-a old",
						"+a new",
						"@@ -9 +9 @@",
						"+only here"
					),
					hunk("x/b", "-a old", "+a new"),
				].join("\n")
			);

			expect(changes.map((c) => c.cases)).toEqual([
				["x/a", "x/b"],
				["x/a"],
			]);
		});

		it("should ignore the file headers", () => {
			expect(summarizeTranscriptDiff(hunk("x/a"))).toEqual([]);
		});

		it("should read a line that starts with dashes as a change", () => {
			const changes = summarizeTranscriptDiff(
				hunk("x/a", "--- gone", "+++ here")
			);

			expect(changes).toEqual([
				change({
					removed: "-- gone",
					added: "++ here",
					cases: ["x/a"],
				}),
			]);
		});

		it("should name a case file other than the transcript by its path", () => {
			const changes = summarizeTranscriptDiff(
				[
					"diff --git a/e2e/cases/x/a/case.json b/e2e/cases/x/a/case.json",
					"--- a/e2e/cases/x/a/case.json",
					"+++ b/e2e/cases/x/a/case.json",
					"@@ -1 +1 @@",
					'+{ "steps": [] }',
				].join("\n")
			);

			expect(changes[0]?.cases).toEqual(["x/a/case.json"]);
		});
	});

	describe("formatSummary", () => {
		const four = ["a/1", "a/2", "a/3", "a/4"];

		it("should say nothing changed when no transcript differs", () => {
			expect(formatSummary([], [])).toBe("No transcript changed.");
		});

		it("should show an edit as git shows a word diff, with its count", () => {
			const text = formatSummary(
				[
					change({
						before: "Declare variants ",
						removed: "under",
						added: "in",
						after: ' "variants"',
						cases: four,
					}),
					change({ added: "Wrote 2 files.", cases: four }),
				],
				[]
			);

			expect(text).toBe(
				[
					"4 transcripts changed, 2 distinct changes.",
					"",
					'  4×  Declare variants [-under-]{+in+} "variants"',
					"  4×  + Wrote 2 files.",
				].join("\n")
			);
		});

		it("should show a line that disappears with a minus", () => {
			const text = formatSummary(
				[change({ removed: "gone", cases: four })],
				[]
			);

			expect(text).toContain("  4×  - gone");
		});

		it("should name the transcripts of an edit that few of them share", () => {
			const text = formatSummary(
				[change({ added: "surprise", cases: ["a/1", "b/2"] })],
				[]
			);

			expect(text).toContain("  2×  + surprise\n      in a/1, b/2");
		});

		it("should report transcripts that are new", () => {
			expect(formatSummary([], ["a/new"])).toBe(
				"1 new transcript: a/new"
			);
		});
	});
});
