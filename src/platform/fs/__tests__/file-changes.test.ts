import {
	FileChange,
	FileChangeType,
	normalizeFileChanges,
} from "../file-changes.js";
import { FileType } from "../file-system-service.js";

const change = (type: FileChangeType, path = "/a"): FileChange => ({
	type,
	path,
	fileType: FileType.File,
});

const { ADDED, DELETED, UPDATED } = FileChangeType;
const types = (...sequence: FileChangeType[]) =>
	normalizeFileChanges(sequence.map((type) => change(type))).map(
		({ type }) => type
	);

describe("normalizeFileChanges", () => {
	it("should drop a path that was added and deleted", () => {
		expect(types(ADDED, DELETED)).toEqual([]);
	});

	it("should keep an add when an update follows", () => {
		expect(types(ADDED, UPDATED)).toEqual([ADDED]);
	});

	it("should keep a delete of a path that was there before, however often it came back", () => {
		expect(types(DELETED, ADDED, DELETED)).toEqual([DELETED]);
	});

	it("should drop a path added, deleted and added again, down to the add", () => {
		expect(types(ADDED, DELETED, ADDED)).toEqual([ADDED]);
	});

	it("should keep the latest of other changes", () => {
		expect(types(UPDATED, DELETED)).toEqual([DELETED]);
		expect(types(DELETED, ADDED)).toEqual([ADDED]);
	});

	it("should treat each path on its own", () => {
		expect(
			normalizeFileChanges([
				change(ADDED, "/a"),
				change(UPDATED, "/b"),
				change(DELETED, "/a"),
			]).map(({ path }) => path)
		).toEqual(["/b"]);
	});
});
