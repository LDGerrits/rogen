import { MemoryFileSystemService } from "../../../../platform/fs/memory-file-system-service.js";
import { abs, assembleFilesOf, writeFiles } from "../../__tests__/fixtures.js";

describe("MountClashes", () => {
	let fs: MemoryFileSystemService;

	const warningsOf = async (ignored: string[] = []) =>
		(
			await assembleFilesOf(fs, {
				routes: { "*": "ReplicatedStorage/Lib" },
				ignored,
				project: {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Lib: { $path: "vendor/Lib" },
						},
					},
				},
			})
		).warnings.filter(({ code }) => code === "tree.mountClash");

	beforeEach(() => {
		fs = new MemoryFileSystemService();
	});

	it("should warn once for the files that sit next to the mount's own instances of their names", async () => {
		await writeFiles(
			fs,
			"vendor/Lib/Util.luau",
			"vendor/Lib/Combat/init.luau",
			"src/Util.luau",
			"src/Combat/Hit.luau",
			"src/Combat/Miss.luau",
			"src/Other.luau"
		);

		const [warning, ...others] = await warningsOf();

		expect(others).toEqual([]);
		expect(warning.message).toContain("3 files sit next to instances");
		expect(warning.message).toContain(
			`${abs("src/Combat/Hit.luau")} -> ReplicatedStorage/Lib/Combat/Hit (next to "Combat")`
		);
		expect(warning.message).not.toContain("Other");
		expect(warning.related).toEqual([
			{
				resource: abs("src/Combat/Hit.luau"),
				message: expect.stringContaining('makes a "Combat" next to'),
			},
			{
				resource: abs("src/Combat/Miss.luau"),
				message: expect.stringContaining('makes a "Combat" next to'),
			},
			{
				resource: abs("src/Util.luau"),
				message: expect.stringContaining('makes a "Util" next to'),
			},
		]);
	});

	it("should not warn when the mount holds nothing of the name", async () => {
		await writeFiles(fs, "vendor/Lib/Util.luau", "src/Other.luau");

		expect(await warningsOf()).toEqual([]);
	});

	it("should not warn of a file the mount does not hold a name for", async () => {
		await writeFiles(fs, "vendor/Lib/README.md", "src/README.luau");

		expect(await warningsOf()).toEqual([]);
	});

	it("should not count what the config ignores in the mount", async () => {
		await writeFiles(fs, "vendor/Lib/Combat.luau", "src/Combat.luau");

		expect(await warningsOf([abs("vendor/Lib/Combat.luau")])).toEqual([]);
	});
});
