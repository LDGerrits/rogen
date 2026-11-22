import { jest } from "@jest/globals";

jest.unstable_mockModule("../../../../base/platform.js", () => ({
	isWindows: false,
	ignoresPathCase: true,
}));

const { MemoryFileSystemService } =
	await import("../../../../platform/fs/memory-file-system-service.js");
const { abs, configOf, indexOf, placeFiles, syncTools, writeFiles } =
	await import("../../__tests__/fixtures.js");
const { compiledPathCheckOf } = await import("../../__tests__/write-of.js");

describe("CompiledPathCheck where the file system ignores case", () => {
	it("should count a compiled file spelled in another case as made by its source", async () => {
		const fs = new MemoryFileSystemService();
		await writeFiles(
			fs,
			"src/Inventory/server/Save.ts",
			"dist/Inventory/Server/Save.luau"
		);
		const config = configOf({ compiledPath: abs("dist") });
		const index = await indexOf(fs, config.sourcePaths);

		const warnings = await compiledPathCheckOf(fs).check(
			placeFiles(index, config, syncTools).unwrap()
		);

		expect(
			warnings.filter(({ code }) => code === "compiled.orphan")
		).toEqual([]);
	});
});
