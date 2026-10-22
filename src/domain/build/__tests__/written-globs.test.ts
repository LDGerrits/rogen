import { CompiledLayout } from "../compiled-layout.js";
import { WrittenGlobs } from "../written-globs.js";
import { abs, configOf, syncTools } from "./fixtures.js";

const globsOf = (compiledPath?: string, mounts: readonly string[] = []) => {
	const config = configOf({
		compiledPath: compiledPath && abs(compiledPath),
	});
	return new WrittenGlobs(
		new CompiledLayout(config, syncTools),
		mounts.map((mount) => abs(mount))
	);
};

describe("WrittenGlobs", () => {
	it("should write a glob as it is when nothing moves", () => {
		expect(globsOf().of("src/**/*.draft.luau")).toEqual([
			"src/**/*.draft.luau",
		]);
	});

	it("should move a ! glob under the compiled path and keep it a negation", () => {
		expect(
			globsOf("out", ["src/Vendor"]).of("!src/**/Keep.spec.luau")
		).toEqual(["!out/**/Keep.spec.luau", "!src/**/Keep.spec.luau"]);
	});

	it("should move a glob under the compiled path", () => {
		expect(globsOf("out").of("src/**/*.draft.luau")).toEqual([
			"out/**/*.draft.luau",
		]);
	});

	it("should keep the glob as it was beside the move where a mount lies under it", () => {
		expect(
			globsOf("out", ["src/Vendor"]).of("src/**/*.draft.luau")
		).toEqual(["out/**/*.draft.luau", "src/**/*.draft.luau"]);
		expect(globsOf("out", ["src/Vendor"]).of("src/Vendor/*.x")).toEqual([
			"out/Vendor/*.x",
			"src/Vendor/*.x",
		]);
	});

	it("should not keep the glob for a mount that lies elsewhere", () => {
		expect(globsOf("out", ["vendor"]).of("src/*.x")).toEqual(["out/*.x"]);
		expect(globsOf("out", ["src/Vendor"]).of("src/Other/*.x")).toEqual([
			"out/Other/*.x",
		]);
	});

	it("should leave a glob that begins with a wildcard where it is", () => {
		expect(globsOf("out", ["src/Vendor"]).of("**/*.spec.luau")).toEqual([
			"**/*.spec.luau",
		]);
	});

	it("should not move a glob whose first folder is a pattern", () => {
		const globs = globsOf("out", ["src/Vendor"]);

		expect(globs.moved("{src,lib}/*.md")).toBeUndefined();
		expect(globs.of("{src,lib}/*.md")).toEqual(["{src,lib}/*.md"]);
	});

	it("should rebase a glob from the folder it was written in", () => {
		const config = configOf({
			file: abs("places/lobby/default.rogen.json"),
		});
		const globs = new WrittenGlobs(
			new CompiledLayout(config, syncTools),
			[]
		);

		expect(globs.of("src/*.md", abs(""))).toEqual(["../../src/*.md"]);
	});
});
