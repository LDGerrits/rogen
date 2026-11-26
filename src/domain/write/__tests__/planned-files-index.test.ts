import { toPosix } from "../../../base/path.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { Listing } from "../../../platform/fs/index-service.js";
import { PlannedFilesIndex } from "../locate/planned-files-index.js";
import { abs, configOf } from "./fixtures.js";

describe("PlannedFilesIndex", () => {
	it("should give the type of a listed entry, and of a planned file and its new folders", () => {
		const config = configOf();
		const index = new PlannedFilesIndex(
			new Listing(
				new Map([
					[toPosix(abs("src")), new Map([["A.luau", FileType.File]])],
				])
			),
			config.sourcePaths,
			[abs("src/New/B.luau")],
			(source) => config.compiled.fileOf(source)
		);

		expect(index.getEntryType(abs("src"), "A.luau")).toBe(FileType.File);
		expect(index.getEntryType(abs("src"), "New")).toBe(FileType.Directory);
		expect(index.getEntryType(abs("src/New"), "B.luau")).toBe(
			FileType.File
		);
		expect(index.getEntryType(abs("src"), "Gone.luau")).toBeUndefined();
	});
});
