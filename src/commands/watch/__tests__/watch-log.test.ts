import path from "path";
import { mockEntry } from "../../../domain/config/__tests__/mock-config-service.js";
import {
	RebuildReport,
	WatchUpdate,
} from "../../../domain/watch/watch-service.js";
import {
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

		it("should say a burst rebuilt everything", () => {
			expect(logged({ cause: { kind: "burst" } })[0].text).toBe(
				"03:04:05 · many changes · full rebuild"
			);
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

	describe("diagnostics it already printed", () => {
		const warning = (message: string) =>
			warningDiagnostic("x.warn", { resource: "/repo/src" }, message);
		const entry = mockEntry({}, path.join(cwd, "default.rogen.json"));

		const reportOf = (
			diagnostics: RebuildReport["diagnostics"],
			syncDiagnostics?: RebuildReport["syncDiagnostics"]
		): RebuildReport => ({
			entry,
			config: entry.resolved!,
			outcome: "unchanged",
			diagnostics,
			syncDiagnostics,
			summary: {
				roots: [],
				routes: [],
				tags: [],
				unrouted: 0,
				superseded: 0,
				displaced: 0,
			},
		});

		const session = () => {
			const logService = new MockLogService();
			const log = new WatchLog(logService, cwd);
			const texts = () =>
				logService.entries
					.filter(
						({ kind }) =>
							kind === "diagnosticWarning" ||
							kind === "diagnosticError"
					)
					.map((logged) => logged.text);
			return { log, logService, texts };
		};

		it("should print a build warning once while it persists", () => {
			const { log, texts } = session();

			log.update(updateOf({ reports: [reportOf([warning("a")])] }));
			log.update(
				updateOf({ reports: [reportOf([warning("a"), warning("b")])] })
			);

			expect(texts().filter((text) => text.includes(": a"))).toHaveLength(
				1
			);
			expect(texts().filter((text) => text.includes(": b"))).toHaveLength(
				1
			);
		});

		it("should print it again after it went away", () => {
			const { log, texts } = session();

			log.update(updateOf({ reports: [reportOf([warning("a")])] }));
			log.update(updateOf({ reports: [reportOf([])] }));
			log.update(updateOf({ reports: [reportOf([warning("a")])] }));

			expect(texts().filter((text) => text.includes(": a"))).toHaveLength(
				2
			);
		});

		it("should track the sync dir check apart from the build, and keep it when a round doesn't check", () => {
			const { log, texts } = session();

			log.update(updateOf({ reports: [reportOf([], [warning("s")])] }));
			log.update(updateOf({ reports: [reportOf([])] }));
			log.update(updateOf({ reports: [reportOf([], [warning("s")])] }));

			expect(texts().filter((text) => text.includes(": s"))).toHaveLength(
				1
			);
		});

		it("should say nothing for a round whose only news is a config problem it already printed", () => {
			const { log, logService } = session();
			const notice = {
				file: entry.file,
				errors: [
					errorDiagnostic("x.err", { resource: entry.file }, "bad."),
				],
				warnings: [],
			};

			log.update(updateOf({ notices: [notice] }));
			const before = logService.entries.length;
			log.update(updateOf({ notices: [notice] }));

			expect(logService.entries).toHaveLength(before);
		});
	});
});
