import {
	FileChange,
	FileChangeType,
} from "../../../platform/fs/file-events.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { dropSourceUpdates } from "../drop-source-updates.js";

const change = (type: FileChangeType, path: string): FileChange => ({
	type,
	path,
	fileType: FileType.File,
});

describe("domain/watch/drop-source-updates", () => {
	const contentFiles = new Set(["/repo/default.rogen.json", "/repo/t.json"]);

	it("should drop an update to a source file", () => {
		const updated = change(FileChangeType.UPDATED, "/repo/src/A.luau");

		expect(dropSourceUpdates([updated], contentFiles)).toEqual([]);
	});

	it("should keep an update to a config", () => {
		const updated = change(
			FileChangeType.UPDATED,
			"/repo/default.rogen.json"
		);

		expect(dropSourceUpdates([updated], contentFiles)).toEqual([updated]);
	});

	it("should keep an update to a template", () => {
		const updated = change(FileChangeType.UPDATED, "/repo/t.json");

		expect(dropSourceUpdates([updated], contentFiles)).toEqual([updated]);
	});

	it("should keep additions and deletions of source files", () => {
		const changes = [
			change(FileChangeType.ADDED, "/repo/src/A.luau"),
			change(FileChangeType.DELETED, "/repo/src/B.luau"),
		];

		expect(dropSourceUpdates(changes, contentFiles)).toEqual(changes);
	});
});
