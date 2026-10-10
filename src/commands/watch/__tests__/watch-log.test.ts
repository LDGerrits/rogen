import path from "path";
import { mockEntry } from "../../../domain/config/__tests__/mock-config-service.js";
import {
	RebuildReport,
	WatchUpdate,
} from "../../../domain/watch/watch-service.js";
import {
	LoadedBuild,
	FailedBuild,
	WrittenBuild,
} from "../../../domain/build/build.js";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import {
	FileChange,
	FileChangeType,
} from "../../../platform/fs/file-changes.js";
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

const logged = (update: Partial<WatchUpdate>) => {
	const logService = new MockLogService();
	logService.setLevel(LogLevel.Debug);
	new WatchLog(logService, cwd).update(updateOf(update));
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
				text: "03:04:05 · initial build",
			});
		});

		it("should say a burst dropped the changes and rebuilt everything", () => {
			const lines = logged({
				cause: {
					kind: "burst",
					dropped: 250,
					threshold: 200,
					ended: false,
				},
			});

			expect(lines.map(({ kind, text }) => [kind, text])).toEqual([
				[
					"warn",
					"Threshold reached (250 > 200). Dropping the buffered changes.",
				],
				["step", "03:04:05 · many changes · full rebuild"],
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
			expect(titleOf(3, ["a.rogen.json", "b.rogen.json"], true)).toBe(
				"03:04:05 · 3 files changed · a.rogen.json, b.rogen.json changed · reloaded"
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

	describe("a rebuild", () => {
		const warning = (message: string) =>
			warningDiagnostic("x.warn", { resource: "/repo/src" }, message);
		const entry = mockEntry({}, path.join(cwd, "default.rogen.json"));

		const reportOf = (
			build: LoadedBuild,
			unreported: readonly Diagnostic[],
			repeatedFailure = false,
			repeated: readonly Diagnostic[] = [],
			fixed: readonly Diagnostic[] = []
		): RebuildReport => ({
			build,
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
			const built = new WrittenBuild(
				entry.config,
				"unchanged",
				{ warnings: [warning("a"), warning("b")], syncWarnings: [] },
				{
					roots: [],
					routes: [],
					variants: [],
					modes: [],
					unrouted: 0,
					replaced: 0,
					displaced: 0,
				},
				[]
			);

			log.update(
				updateOf({ reports: [reportOf(built, [warning("b")])] })
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
			const failed = new FailedBuild(entry.config, [error]);

			log.update(updateOf({ reports: [reportOf(failed, [error])] }));
			log.update(updateOf({ reports: [reportOf(failed, [], true)] }));

			expect(logService.texts("error")).toEqual([
				"default.project.json · not written",
				"default.project.json · not written · same errors as before",
			]);
		});

		const built = (warnings: Diagnostic[]) =>
			new WrittenBuild(
				entry.config,
				"wrote",
				{ warnings, syncWarnings: [] },
				{
					roots: [],
					routes: [],
					variants: [],
					modes: [],
					unrouted: 0,
					replaced: 0,
					displaced: 0,
				},
				[]
			);
		const resultLine = (reports: RebuildReport[]) => {
			const { log, logService } = session();
			log.update(updateOf({ reports }));
			return logService.entries.find(({ kind }) => kind === "success")
				?.text;
		};

		it("should count the warnings it leaves out", () => {
			const standing = [warning("a"), warning("b"), warning("c")];

			expect(
				resultLine([reportOf(built(standing), [], false, standing)])
			).toBe("default.project.json · wrote · 3 warnings as before");
			expect(
				resultLine([
					reportOf(
						built(standing.slice(0, 1)),
						[],
						false,
						standing.slice(0, 1)
					),
				])
			).toBe("default.project.json · wrote · 1 warning as before");
		});

		it("should count the warnings it leaves out of a failed build too", () => {
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
							new FailedBuild(entry.config, [error], {
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

			expect(resultLine([reportOf(built([]), [])])).toBe(
				"default.project.json · wrote"
			);
			expect(
				resultLine([
					reportOf(built([fresh, warning("old")]), [fresh], false, [
						warning("old"),
					]),
				])
			).toBe("default.project.json · wrote · 1 warning as before");
		});

		it("should say how many diagnostics a rebuild fixed, after the ones left out", () => {
			const standing = warning("old");

			expect(
				resultLine([
					reportOf(
						built([standing]),
						[],
						false,
						[standing],
						[warning("gone"), warning("gone too")]
					),
				])
			).toBe(
				"default.project.json · wrote · 1 warning as before · 2 warnings fixed"
			);
			expect(
				resultLine([
					reportOf(
						built([]),
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
			).toBe("default.project.json · wrote · 1 error fixed");
		});

		it("should print a warning two configs of one round share once, and say so on the second", () => {
			const shared = warning("shared");
			const lobby = mockEntry(
				{ outFile: path.join(cwd, "lobby.project.json") },
				path.join(cwd, "lobby.rogen.json")
			);
			const { log, logService } = session();

			log.update(
				updateOf({
					reports: [
						reportOf(built([shared]), [shared]),
						reportOf(
							new WrittenBuild(
								lobby.config,
								"wrote",
								{ warnings: [shared], syncWarnings: [] },
								built([]).summary,
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
				["success", "default.project.json · wrote"],
				["diagnosticWarning", expect.stringContaining(": shared")],
				[
					"success",
					"lobby.project.json · wrote · same warnings as default",
				],
			]);
		});

		it("should print a config's new errors and say its last valid version still builds", () => {
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
					"Still building from the last valid default.rogen.json.",
				],
			]);
		});

		it("should say a config that was never valid isn't built, and a config added or removed", () => {
			const { log, logService } = session();
			const error = errorDiagnostic(
				"x.err",
				{ resource: "/repo/lobby.rogen.json" },
				"bad."
			);

			log.update(
				updateOf({
					notices: [
						{ kind: "added", file: "/repo/match.rogen.json" },
						{ kind: "removed", file: "/repo/arena.rogen.json" },
						{
							kind: "broken",
							file: "/repo/lobby.rogen.json",
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
				["info", "match.rogen.json added. Building it too."],
				["info", "arena.rogen.json removed. No longer building it."],
				["diagnosticError", expect.stringContaining("bad.")],
				["error", "Not building lobby.rogen.json until it loads."],
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
