import path from "path";
import { mockEntry } from "../../../domain/config/__tests__/mock-config-service.js";
import {
	RewriteReport,
	WatchUpdate,
} from "../../../domain/watch/watch-service.js";
import {
	LoadedConfig,
	FailedConfig,
	WrittenConfig,
} from "../../../domain/write/write.js";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import {
	FileChange,
	FileChangeType,
} from "../../../platform/fs/file-changes.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { WatchLog } from "../watch-log.js";

const cwd = path.resolve("/repo");

const change = (type: FileChangeType, file: string): FileChange => ({
	type,
	path: path.join(cwd, file),
	fileType: FileType.File,
});

const updateOf = (update: Partial<WatchUpdate>): WatchUpdate => ({
	at: new Date(2026, 0, 2, 3, 4, 5),
	cause: { kind: "initial" },
	changes: [],
	notices: [],
	reports: [],
	...update,
});

const wrote: RewriteReport = {
	outcome: new WrittenConfig(
		mockEntry({}, path.join(cwd, "default.rogen.json")).config,
		"wrote",
		{ warnings: [], syncWarnings: [] },
		{ roots: [], routes: [], unrouted: 0, replaced: 0, displaced: 0 },
		[]
	),
	unreported: [],
	repeated: [],
	fixed: [],
	repeatedFailure: false,
};

const logged = (update: Partial<WatchUpdate>) => {
	const logService = new MockLogService();
	logService.setLevel(LogLevel.Debug);
	new WatchLog(logService, cwd).update(
		updateOf({ reports: [wrote], ...update })
	);
	return logService.entries;
};

const titleOf = (
	sourceFiles: number,
	configFiles: string[],
	reloaded: boolean
) =>
	logged({
		cause: {
			kind: "change",
			sourceFiles,
			configFiles: configFiles.map((file) => path.join(cwd, file)),
			reloaded,
		},
	})[0].text;

describe("WatchLog.update", () => {
	describe("the title", () => {
		it("should start with the time, padded to two digits", () => {
			expect(logged({})[0]).toEqual({
				kind: "step",
				text: "03:04:05 · initial write",
			});
		});

		it("should say a burst dropped the changes and rewrote everything", () => {
			const lines = logged({
				cause: {
					kind: "burst",
					dropped: 250,
					threshold: 200,
					ended: false,
				},
				reports: [],
			});

			expect(lines.map(({ kind, text }) => [kind, text])).toEqual([
				[
					"warn",
					"Threshold reached (250 > 200). Dropping the buffered changes.",
				],
				["step", "03:04:05 · many changes · full rewrite"],
			]);
		});

		it("should say a burst has stopped, without a threshold it did not cross", () => {
			const lines = logged({
				cause: {
					kind: "burst",
					dropped: 101,
					threshold: 200,
					ended: true,
				},
			});

			expect(lines[0]).toEqual({
				kind: "warn",
				text: "The burst has stopped, after 101 more changes.",
			});
		});

		it("should count the compiled files that changed", () => {
			expect(
				logged({ cause: { kind: "compiled", files: 2 } })[0].text
			).toBe("03:04:05 · 2 compiled files changed");
		});

		it("should count source files", () => {
			expect(titleOf(2, [], false)).toContain("2 files changed");
			expect(titleOf(1, [], false)).toContain("1 file changed");
		});

		it("should name a config that changed and was reloaded", () => {
			expect(titleOf(0, ["default.rogen.json"], true)).toBe(
				"03:04:05 · default.rogen.json changed · reloaded"
			);
		});

		it("should not claim a reload for a config that was not reloaded", () => {
			expect(titleOf(0, ["default.rogen.json"], false)).toBe(
				"03:04:05 · default.rogen.json changed"
			);
		});

		it("should combine source and config changes", () => {
			expect(
				titleOf(
					3,
					["a/default.rogen.json", "b/default.rogen.json"],
					true
				)
			).toBe(
				"03:04:05 · 3 files changed · a/default.rogen.json, b/default.rogen.json changed · reloaded"
			);
		});
	});

	describe("the changed files", () => {
		const lines = (changes: FileChange[]) =>
			logged({ changes })
				.filter(({ kind }) => kind === "debug")
				.map(({ text }) => text);

		it("should name each file relative to the working directory, by what happened", () => {
			expect(
				lines([
					change(FileChangeType.ADDED, "src/New.luau"),
					change(FileChangeType.UPDATED, "src/Hud.luau"),
					change(FileChangeType.DELETED, "src/Old.luau"),
				])
			).toEqual([
				"added src/New.luau",
				"changed src/Hud.luau",
				"deleted src/Old.luau",
			]);
		});

		it("should list only the first files of a large change", () => {
			const changes = Array.from({ length: 25 }, (_, i) =>
				change(FileChangeType.UPDATED, `src/F${i}.luau`)
			);

			const listed = lines(changes);

			expect(listed).toHaveLength(21);
			expect(listed[19]).toBe("changed src/F19.luau");
			expect(listed[20]).toBe("and 5 more");
		});
	});

	describe("a rewrite", () => {
		const warning = (message: string) =>
			warningDiagnostic("x.warn", { resource: "/repo/src" }, message);
		const entry = mockEntry({}, path.join(cwd, "default.rogen.json"));

		const reportOf = (
			outcome: LoadedConfig,
			unreported: readonly Diagnostic[],
			repeatedFailure = false,
			repeated: readonly Diagnostic[] = [],
			fixed: readonly Diagnostic[] = []
		): RewriteReport => ({
			outcome,
			unreported,
			repeated,
			fixed,
			repeatedFailure,
		});

		const session = () => {
			const logService = new MockLogService();
			const log = new WatchLog(logService, cwd);
			return { log, logService };
		};

		it("should print only the diagnostics the session hadn't reported", () => {
			const { log, logService } = session();
			const outcome = new WrittenConfig(
				entry.config,
				"unchanged",
				{ warnings: [warning("a"), warning("b")], syncWarnings: [] },
				{
					roots: [],
					routes: [],
					unrouted: 0,
					replaced: 0,
					displaced: 0,
				},
				[]
			);

			log.update(
				updateOf({ reports: [reportOf(outcome, [warning("b")])] })
			);

			expect(logService.texts("diagnosticWarning")).toEqual([
				expect.stringContaining(": b"),
			]);
		});

		it("should say a failed config's errors were printed before, rather than print them again", () => {
			const { log, logService } = session();
			const error = errorDiagnostic(
				"x.err",
				{ resource: entry.file },
				"bad."
			);
			const failed = new FailedConfig(entry.config, [error]);

			log.update(updateOf({ reports: [reportOf(failed, [error])] }));
			log.update(updateOf({ reports: [reportOf(failed, [], true)] }));

			expect(logService.texts("error")).toEqual([
				"default.project.json · not written",
				"default.project.json · not written · same errors as before",
			]);
		});

		const writtenWith = (warnings: Diagnostic[]) =>
			new WrittenConfig(
				entry.config,
				"wrote",
				{ warnings, syncWarnings: [] },
				{
					roots: [],
					routes: [],
					unrouted: 0,
					replaced: 0,
					displaced: 0,
				},
				[]
			);
		const resultLine = (reports: RewriteReport[]) => {
			const { log, logService } = session();
			log.update(updateOf({ reports }));
			return logService.entries.find(({ kind }) => kind === "success")
				?.text;
		};

		it("should count the warnings it leaves out", () => {
			const standing = [warning("a"), warning("b"), warning("c")];

			expect(
				resultLine([
					reportOf(writtenWith(standing), [], false, standing),
				])
			).toBe("Wrote default.project.json (3 warnings as before).");
			expect(
				resultLine([
					reportOf(
						writtenWith(standing.slice(0, 1)),
						[],
						false,
						standing.slice(0, 1)
					),
				])
			).toBe("Wrote default.project.json (1 warning as before).");
		});

		it("should count the warnings it leaves out of a failed write too", () => {
			const error = errorDiagnostic(
				"x.err",
				{ resource: entry.file },
				"bad."
			);
			const { log, logService } = session();

			log.update(
				updateOf({
					reports: [
						reportOf(
							new FailedConfig(entry.config, [error], {
								warnings: [warning("a"), warning("b")],
								syncWarnings: [],
							}),
							[error],
							false,
							[warning("a"), warning("b")]
						),
					],
				})
			);

			expect(
				logService.entries.find(({ kind }) => kind === "error")?.text
			).toBe("default.project.json · not written · 2 warnings as before");
		});

		it("should say nothing when it left nothing out, and print what is new beside the count", () => {
			const fresh = warning("new");

			expect(resultLine([reportOf(writtenWith([]), [])])).toBe(
				"Wrote default.project.json."
			);
			expect(
				resultLine([
					reportOf(
						writtenWith([fresh, warning("old")]),
						[fresh],
						false,
						[warning("old")]
					),
				])
			).toBe("Wrote default.project.json (1 warning as before).");
		});

		it("should say how many diagnostics a rewrite fixed, after the ones left out", () => {
			const standing = warning("old");

			expect(
				resultLine([
					reportOf(
						writtenWith([standing]),
						[],
						false,
						[standing],
						[warning("gone"), warning("gone too")]
					),
				])
			).toBe(
				"Wrote default.project.json (1 warning as before, 2 warnings fixed)."
			);
			expect(
				resultLine([
					reportOf(
						writtenWith([]),
						[],
						false,
						[],
						[
							errorDiagnostic(
								"x.err",
								{ resource: entry.file },
								"bad."
							),
						]
					),
				])
			).toBe("Wrote default.project.json (1 error fixed).");
		});

		it("should print a warning two configs of one round share once, and say so on the second", () => {
			const shared = warning("shared");
			const lobby = mockEntry(
				{ name: "lobby" },
				path.join(cwd, "lobby/default.rogen.json")
			);
			const { log, logService } = session();

			log.update(
				updateOf({
					reports: [
						reportOf(writtenWith([shared]), [shared]),
						reportOf(
							new WrittenConfig(
								lobby.config,
								"wrote",
								{ warnings: [shared], syncWarnings: [] },
								writtenWith([]).summary,
								[]
							),
							[shared]
						),
					],
				})
			);

			expect(
				logService.entries
					.filter(({ kind }) =>
						["success", "diagnosticWarning"].includes(kind)
					)
					.map(({ kind, text }) => [kind, text])
			).toEqual([
				["success", "Wrote default.project.json."],
				["diagnosticWarning", expect.stringContaining(": shared")],
				[
					"success",
					"Wrote lobby/default.project.json (same warnings as default.rogen.json).",
				],
			]);
		});

		it("should print a config's new errors and say its last valid version is still written", () => {
			const { log, logService } = session();
			const error = errorDiagnostic(
				"x.err",
				{ resource: entry.file },
				"bad."
			);

			log.update(
				updateOf({
					notices: [
						{
							kind: "broken",
							file: entry.file,
							errors: [error],
							keptLastValid: true,
						},
					],
				})
			);

			expect(
				logService.entries
					.filter(({ kind }) => kind !== "step")
					.map(({ kind, text }) => [kind, text])
			).toEqual([
				["diagnosticError", expect.stringContaining("bad.")],
				[
					"error",
					"Still writing from the last valid default.rogen.json.",
				],
			]);
		});

		it("should say it waits for a broken plain project file, which it never writes", () => {
			const { log, logService } = session();
			const file = "/repo/default.project.json";

			log.update(
				updateOf({
					notices: [
						{
							kind: "broken",
							file,
							errors: [
								errorDiagnostic(
									"x.err",
									{ resource: file },
									"bad."
								),
							],
							keptLastValid: true,
						},
					],
				})
			);

			expect(
				logService.entries
					.filter(({ kind }) => kind === "error")
					.map(({ text }) => text)
			).toEqual(["Waiting until default.project.json loads."]);
		});

		it("should say a config that was never valid isn't written, and a config added or removed", () => {
			const { log, logService } = session();
			const error = errorDiagnostic(
				"x.err",
				{ resource: "/repo/lobby/default.rogen.json" },
				"bad."
			);

			log.update(
				updateOf({
					notices: [
						{
							kind: "added",
							file: "/repo/match/default.rogen.json",
						},
						{
							kind: "removed",
							file: "/repo/arena/default.rogen.json",
						},
						{
							kind: "broken",
							file: "/repo/lobby/default.rogen.json",
							errors: [error],
							keptLastValid: false,
						},
					],
				})
			);

			expect(
				logService.entries
					.filter(({ kind }) => kind !== "step")
					.map(({ kind, text }) => [kind, text])
			).toEqual([
				["info", "match/default.rogen.json added. Writing it too."],
				[
					"info",
					"arena/default.rogen.json removed. No longer writing it.",
				],
				["diagnosticError", expect.stringContaining("bad.")],
				[
					"error",
					"Not writing lobby/default.rogen.json until it loads.",
				],
			]);
		});

		it("should say a broken config loads again", () => {
			const { log, logService } = session();

			log.update(
				updateOf({ notices: [{ kind: "recovered", file: entry.file }] })
			);

			expect(
				logService.entries
					.filter(({ kind }) => kind !== "step")
					.map(({ kind, text }) => [kind, text])
			).toEqual([["info", "default.rogen.json loads again."]]);
		});
	});
});

describe("WatchLog.error", () => {
	it("should print the message of a step that failed unexpectedly, as an error", () => {
		const logService = new MockLogService();

		new WatchLog(logService, cwd).error(new Error("the watcher broke"));

		expect(logService.texts("error")).toEqual(["the watcher broke"]);
	});

	it("should print each diagnostic of a failure once, relative to the working directory", () => {
		const logService = new MockLogService(cwd);

		new WatchLog(logService, cwd).error(
			new DiagnosticsError([
				errorDiagnostic(
					"rojo.commandFailed",
					{ resource: path.join(cwd, "default.project.json") },
					"Rojo couldn't build this project:"
				),
			])
		);

		expect(logService.lines).toEqual([
			"diagnosticError: default.project.json - error: Rojo couldn't build this project: (rojo.commandFailed)",
		]);
	});
});
