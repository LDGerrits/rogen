import path from "path";
import { mockEntry } from "../../../domain/config/__tests__/mock-config-service.js";
import {
	RebuildReport,
	WatchUpdate,
} from "../../../domain/watch/watch-service.js";
import { ConfigBuild } from "../../../domain/build/build.js";
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
				cause: { kind: "burst", dropped: 250, threshold: 200 },
			});

			expect(lines.map(({ kind, text }) => [kind, text])).toEqual([
				[
					"warn",
					"Threshold reached (250 > 200). Dropping the buffered changes.",
				],
				["step", "03:04:05 · many changes · full rebuild"],
			]);
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
			build: ConfigBuild,
			unreported: readonly Diagnostic[],
			repeatedFailure = false
		): RebuildReport => ({ build, unreported, repeatedFailure });

		const session = () => {
			const logService = new MockLogService();
			const log = new WatchLog(logService, cwd);
			return { log, logService };
		};

		it("should print only the diagnostics the session hadn't reported", () => {
			const { log, logService } = session();
			const built = ConfigBuild.built(
				entry.config,
				"unchanged",
				{ warnings: [warning("a"), warning("b")], syncWarnings: [] },
				{
					roots: [],
					routes: [],
					variants: [],
					unrouted: 0,
					replaced: 0,
					displaced: 0,
				},
				[]
			);

			log.update(
				updateOf({ reports: [reportOf(built, [warning("b")])] })
			);

			expect(
				logService.entries
					.filter(({ kind }) => kind === "diagnosticWarning")
					.map(({ text }) => text)
			).toEqual([expect.stringContaining(": b")]);
		});

		it("should say a failed config's errors were printed before, rather than print them again", () => {
			const { log, logService } = session();
			const error = errorDiagnostic(
				"x.err",
				{ resource: entry.file },
				"bad."
			);
			const failed = ConfigBuild.failed(entry.config, [error]);

			log.update(updateOf({ reports: [reportOf(failed, [error])] }));
			log.update(updateOf({ reports: [reportOf(failed, [], true)] }));

			expect(
				logService.entries
					.filter(({ kind }) => kind === "error")
					.map(({ text }) => text)
			).toEqual([
				"default.project.json · not written",
				"default.project.json · not written · same errors as before",
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
						{ kind: "broken", file: entry.file, errors: [error] },
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
