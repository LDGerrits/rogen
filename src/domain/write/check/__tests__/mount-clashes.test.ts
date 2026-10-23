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

	it("should warn at each file that sits next to one of the mount's own instances of its name", async () => {
		await writeFiles(
			fs,
			"vendor/Lib/Util.luau",
			"vendor/Lib/Combat/init.luau",
			"src/Util.luau",
			"src/Combat/Hit.luau",
			"src/Combat/Miss.luau",
			"src/Other.luau"
		);

		const warnings = await warningsOf();

		expect(
			warnings.map(({ resource, message }) => [resource, message])
		).toEqual([
			[
				abs("src/Combat/Hit.luau"),
				'makes a "Combat" next to the "Combat" that the mount of vendor/Lib at "ReplicatedStorage/Lib" holds',
			],
			[abs("src/Combat/Miss.luau"), expect.stringContaining('"Combat"')],
			[abs("src/Util.luau"), expect.stringContaining('makes a "Util"')],
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
