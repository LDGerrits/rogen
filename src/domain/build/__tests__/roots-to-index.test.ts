import path from "path";
import { rootsToIndex } from "../roots-to-index.js";
import { abs } from "./fixtures.js";

describe("rootsToIndex", () => {
	it("should drop a dir that lies inside another config's dir", () => {
		expect(
			rootsToIndex([
				{ rootDirs: [abs("src")] },
				{ rootDirs: [abs("src"), abs("src/shared")] },
			])
		).toEqual([abs("src")]);
	});

	it("should keep dirs that only share a name prefix", () => {
		expect(
			rootsToIndex([{ rootDirs: [abs("src"), abs("src-extra")] }])
		).toEqual([abs("src"), abs("src-extra")]);
	});

	it("should drop a nested dir even when it comes first", () => {
		expect(
			rootsToIndex([{ rootDirs: [abs("src/shared"), abs("src")] }])
		).toEqual([abs("src")]);
	});

	it("should resolve relative dirs to absolute ones", () => {
		expect(rootsToIndex([{ rootDirs: ["src"] }])).toEqual([
			path.resolve("src"),
		]);
	});

	it("should return nothing for no configs", () => {
		expect(rootsToIndex([])).toEqual([]);
	});
});
