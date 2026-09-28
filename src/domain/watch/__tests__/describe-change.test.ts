import path from "path";
import {
	FileChange,
	FileChangeType,
} from "../../../platform/fs/file-events.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import {
	clockTime,
	describeChange,
	describeFileChanges,
} from "../describe-change.js";

describe("describeChange", () => {
	it("should count source files", () => {
		expect(
			describeChange({ sourceFiles: 2, configFiles: [], reloaded: false })
		).toBe("2 files changed");
		expect(
			describeChange({ sourceFiles: 1, configFiles: [], reloaded: false })
		).toBe("1 file changed");
	});

	it("should name a config that changed and was reloaded", () => {
		expect(
			describeChange({
				sourceFiles: 0,
				configFiles: ["default.rogen.json"],
				reloaded: true,
			})
		).toBe("default.rogen.json changed · reloaded");
	});

	it("should not claim a reload for a config that was not reloaded", () => {
		expect(
			describeChange({
				sourceFiles: 0,
				configFiles: ["default.rogen.json"],
				reloaded: false,
			})
		).toBe("default.rogen.json changed");
	});

	it("should combine source and config changes", () => {
		expect(
			describeChange({
				sourceFiles: 3,
				configFiles: ["a.rogen.json", "b.rogen.json"],
				reloaded: true,
			})
		).toBe(
			"3 files changed · a.rogen.json, b.rogen.json changed · reloaded"
		);
	});
});

describe("clockTime", () => {
	it("should pad each part to two digits", () => {
		expect(clockTime(new Date(2026, 0, 2, 3, 4, 5))).toBe("03:04:05");
		expect(clockTime(new Date(2026, 0, 2, 12, 34, 56))).toBe("12:34:56");
	});
});

describe("describeFileChanges", () => {
	const cwd = path.resolve("/repo");
	const change = (type: FileChangeType, file: string): FileChange => ({
		type,
		path: path.join(cwd, file),
		fileType: FileType.File,
	});

	it("should name each file relative to the working directory, by what happened", () => {
		expect(
			describeFileChanges(
				[
					change(FileChangeType.ADDED, "src/New.luau"),
					change(FileChangeType.UPDATED, "src/Hud.luau"),
					change(FileChangeType.DELETED, "src/Old.luau"),
				],
				cwd
			)
		).toEqual([
			"added src/New.luau",
			"changed src/Hud.luau",
			"deleted src/Old.luau",
		]);
	});
});
