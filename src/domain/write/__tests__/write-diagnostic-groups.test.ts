import path from "path";
import { WHERE_SCRIPTS_RUN } from "../../roblox/roblox.js";
import {
	Diagnostic,
	errorDiagnostic,
	renderDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { diagnosticGroups } from "../write.js";

describe("diagnosticGroups", () => {
	const warnings = (count: number, code = "route.unrouted") =>
		Array.from({ length: count }, (_, n) =>
			warningDiagnostic(
				code,
				{ resource: `/repo/src/F${n}.luau` },
				"bad."
			)
		);

	const printed = (diagnostics: readonly Diagnostic[]) =>
		diagnosticGroups(diagnostics, "/repo/default.rogen.json").map(
			(diagnostic) => renderDiagnostic(diagnostic)
		);

	it("should print at most ten warnings of one code, the tenth saying how many more there are", () => {
		const lines = printed(warnings(12));

		expect(lines).toHaveLength(10);
		expect(lines[9]).toContain("bad. 2 more like it aren't listed.");
		expect(lines[8]).not.toContain("more like it");
	});

	it("should say 'isn't' for one more", () => {
		expect(printed(warnings(11))[9]).toContain(
			"1 more like it isn't listed."
		);
	});

	it("should print exactly ten without a note", () => {
		expect(printed(warnings(10))[9]).not.toContain("more like it");
	});

	it("should print two dead scripts as one block under the config, headed and listed", () => {
		expect(printed(warnings(2, "tree.deadScript"))).toEqual([
			[
				`${path.normalize("/repo/default.rogen.json")} - warning: 2 scripts will never run where they land: (tree.deadScript)`,
				"  /repo/src/F0.luau (bad.)",
				"  /repo/src/F1.luau (bad.)",
				WHERE_SCRIPTS_RUN,
			].join("\n"),
		]);
	});

	it("should print pattern clashes as one block, each file with its patterns and the fix said once", () => {
		const clash = (file: string, keys: string) =>
			errorDiagnostic(
				"route.patternClash",
				{ resource: `/repo/src/${file}` },
				`${keys} both match this name equally well, and send it to different routes. Lengthen the pattern that should win, or route the file with a folder or an @ name.`
			);

		expect(
			printed([
				clash("MainUi.ts", '"*.ts" and "*Ui.*"'),
				clash("HudUi.ts", '"*.ts" and "*Ui.*"'),
			])
		).toEqual([
			[
				`${path.normalize("/repo/default.rogen.json")} - error: 2 files match patterns as long as each other that send them to different places: (route.patternClash)`,
				'  /repo/src/MainUi.ts ("*.ts" and "*Ui.*")',
				'  /repo/src/HudUi.ts ("*.ts" and "*Ui.*")',
				"Lengthen the pattern that should win, or route the file with a folder or an @ name.",
			].join("\n"),
		]);
	});

	it.each([
		[
			"scan.sourcePathNamedAfterKey",
			1,
			"1 source path is named after a route key, so its name routes nothing:",
			undefined,
		],
		[
			"route.dotRoute",
			2,
			'2 names write a route key after a dot, where only "@" routes, so Rogen stops until they are fixed:',
			undefined,
		],
		[
			"route.serverCodeShipped",
			1,
			"1 file in a folder named for a server route ships to clients:",
			undefined,
		],
		[
			"tree.runContextTarget",
			1,
			"emitLegacyScripts: false makes a client script in StarterPlayerScripts or StarterCharacterScripts a Script with RunContext Client, which runs twice there:",
			"Route client scripts to ReplicatedStorage, or remove emitLegacyScripts from the config.",
		],
		[
			"tree.mountClash",
			2,
			"2 files sit next to an instance of the same name that a mount of the tree holds, so Rojo builds two of each:",
			"Rename one of each pair, or route outside the mounted folder.",
		],
	])(
		"should head a block of %s and close it with its fix",
		(code, count, headline, tail) => {
			const [text] = printed(warnings(count, code));
			const lines = text.split("\n");

			expect(lines[0]).toBe(
				`${path.normalize("/repo/default.rogen.json")} - warning: ${headline} (${code})`
			);
			expect(lines.slice(count + 1)).toEqual(tail ? [tail] : []);
		}
	);

	it("should list a pattern clash whose message names no patterns as it is", () => {
		const [text] = printed([
			errorDiagnostic(
				"route.patternClash",
				{ resource: "/repo/src/A.ts" },
				"clashes."
			),
		]);

		expect(text.split("\n")[1]).toBe("  /repo/src/A.ts (clashes.)");
	});

	it("should list ten files of a block, then count the rest", () => {
		const [text] = printed(warnings(12, "route.strayAt"));

		const lines = text.split("\n");
		expect(lines).toHaveLength(12);
		expect(lines[10]).toEqual("  /repo/src/F9.luau (bad.)");
		expect(lines[11]).toBe("  2 more like it aren't listed.");
	});

	it("should say 'isn't' when one file of a block is left out", () => {
		const [text] = printed(warnings(11, "route.strayAt"));

		expect(text.split("\n")[11]).toBe("  1 more like it isn't listed.");
	});

	it("should cap each code on its own and never an error", () => {
		const errors = Array.from({ length: 12 }, (_, n) =>
			errorDiagnostic("x.err", { resource: `/repo/e${n}` }, "boom.")
		);

		const lines = printed([
			...warnings(11, "a.code"),
			...warnings(11, "b.code"),
			...errors,
		]);

		expect(lines).toHaveLength(32);
	});
});
