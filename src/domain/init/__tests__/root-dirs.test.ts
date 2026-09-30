import path from "path";
import {
	parseRootDirs,
	placeFolderProblem,
	rootDirsProblem,
} from "../root-dirs.js";

const HERE = path.resolve("/repo");

describe("parseRootDirs", () => {
	it("should split on commas, drop empty entries and normalize", () => {
		expect(parseRootDirs(" src, ./shared/ ,, lib")).toEqual([
			"src",
			"shared",
			"lib",
		]);
	});
});

describe("rootDirsProblem", () => {
	it("should accept separate folders", () => {
		expect(rootDirsProblem(HERE, ["src", "lib/shared"])).toBeUndefined();
	});

	it("should accept folders that share a prefix but not a parent", () => {
		expect(rootDirsProblem(HERE, ["src", "src2"])).toBeUndefined();
	});

	it.each([
		[[], "Enter at least one root dir."],
		[["/abs"], "Use a path relative to here, not /abs."],
		[["C:\\game"], "Use a path relative to here, not C:\\game."],
		[["../lib"], "../lib is outside this folder."],
		[["src", "./src"], "src is listed twice."],
		[
			["src", "src/Combat"],
			"src/Combat is inside src. List only one of them.",
		],
		[[".", "src"], "src is inside .. List only one of them."],
	])("should reject %j", (entries, message) => {
		expect(rootDirsProblem(HERE, entries)).toBe(message);
	});
});

describe("placeFolderProblem", () => {
	it("should accept a folder beside the root dirs", () => {
		expect(
			placeFolderProblem(HERE, ["src"], "places/lobby")
		).toBeUndefined();
	});

	it.each([["src/lobby"], ["src"], ["./src/"]])(
		"should reject %j, which overlaps src",
		(folder) => {
			expect(placeFolderProblem(HERE, ["src"], folder)).toMatch(
				/overlaps src, one of default's root dirs/
			);
		}
	);

	it("should reject a folder that holds a root dir", () => {
		expect(placeFolderProblem(HERE, ["game/src"], "game")).toMatch(
			/game overlaps game\/src/
		);
	});

	it("should reject a folder outside this one", () => {
		expect(placeFolderProblem(HERE, ["src"], "../lobby")).toBe(
			"../lobby is outside this folder."
		);
	});
});
