import { jest } from "@jest/globals";
import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { FileChangeType } from "../../../platform/fs/file-events.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ScannedRoot, ScanOptions, scanRootDirs } from "../root-scanner.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

describe("scanRootDirs", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const newIndex = () => store.add(new CoreIndexService(fs));

	const scan = async (options: Partial<ScanOptions> = {}) => {
		const scanOptions: ScanOptions = {
			rootDirs: [abs("src")],
			exclude: [],
			configDir: abs("."),
			...options,
		};
		const index = newIndex();
		await index.initialize([...scanOptions.rootDirs]);
		return scanRootDirs(index, scanOptions);
	};

	const files = (root: ScannedRoot) =>
		root.entries.map((entry) => `${entry.kind}:${entry.relativePath}`);

	const write = async (...paths: string[]) => {
		for (const p of paths) await fs.writeFile(abs(p), "");
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("recognised files", () => {
		it("should keep scripts, models and data files, and record their kind", async () => {
			await write(
				"src/A.luau",
				"src/B.lua",
				"src/C.ts",
				"src/D.tsx",
				"src/E.rbxm",
				"src/F.rbxmx",
				"src/G.json",
				"src/H.toml",
				"src/I.csv",
				"src/J.txt",
				"src/K.yaml",
				"src/L.yml",
				"src/M.msgpack",
				"src/N.md"
			);

			const { roots } = await scan();

			expect(files(roots[0])).toEqual([
				"script:A.luau",
				"script:B.lua",
				"script:C.ts",
				"script:D.tsx",
				"model:E.rbxm",
				"model:F.rbxmx",
				"data:G.json",
				"data:H.toml",
				"data:I.csv",
				"data:J.txt",
				"data:K.yaml",
				"data:L.yml",
				"data:M.msgpack",
				"data:N.md",
			]);
		});

		it("should drop unrecognised extensions", async () => {
			await write(
				"src/A.luau",
				"src/image.png",
				"src/notes",
				"src/x.bak"
			);

			const { roots } = await scan();

			expect(files(roots[0])).toEqual(["script:A.luau"]);
		});

		it("should match extensions in any case", async () => {
			await write("src/A.LUAU", "src/B.Rbxm");

			const { roots } = await scan();

			expect(files(roots[0])).toEqual(["script:A.LUAU", "model:B.Rbxm"]);
		});

		it("should never keep .d.ts files, in any case", async () => {
			await write("src/types.d.ts", "src/Foo.D.TS", "src/Real.ts");

			const { roots } = await scan();

			expect(files(roots[0])).toEqual(["script:Real.ts"]);
		});

		it("should record paths relative to the root dir with posix separators", async () => {
			await write("src/inventory/items/Sword.luau");

			const { roots } = await scan();

			expect(roots[0].entries).toEqual([
				{
					kind: "script",
					rootDir: abs("src"),
					relativePath: "inventory/items/Sword.luau",
				},
			]);
		});

		it("should return entries in a stable, sorted order", async () => {
			await write("src/b/Z.luau", "src/B.luau", "src/a/Y.luau");

			const { roots } = await scan();

			expect(files(roots[0])).toEqual([
				"script:B.luau",
				"script:a/Y.luau",
				"script:b/Z.luau",
			]);
		});
	});

	describe("init folders", () => {
		it("should return a directory holding an init script as one unit", async () => {
			await write("src/Inventory/init.luau", "src/Inventory/Helper.luau");

			const { roots } = await scan();

			expect(roots[0].entries).toEqual([
				{
					kind: "init-folder",
					rootDir: abs("src"),
					relativePath: "Inventory",
					initFile: "init.luau",
				},
			]);
		});

		it("should recognise index scripts", async () => {
			await write("src/Inventory/index.ts");

			const { roots } = await scan();

			expect(roots[0].entries).toMatchObject([
				{ kind: "init-folder", initFile: "index.ts" },
			]);
		});

		it("should recognise init scripts that carry a suffix", async () => {
			await write("src/A/init.server.luau", "src/B/index@client.ts");

			const { roots } = await scan();

			expect(roots[0].entries).toMatchObject([
				{ relativePath: "A", initFile: "init.server.luau" },
				{ relativePath: "B", initFile: "index@client.ts" },
			]);
		});

		it("should not traverse beneath an init folder", async () => {
			await write(
				"src/Inventory/init.luau",
				"src/Inventory/deep/Nested.luau",
				"src/Inventory/deep/.server"
			);

			const { roots } = await scan();

			expect(files(roots[0])).toEqual(["init-folder:Inventory"]);
			expect(roots[0].markers).toEqual([]);
		});

		it("should still treat a directory with only index.ts and types.d.ts as one unit", async () => {
			await write("src/Lib/index.ts", "src/Lib/types.d.ts");

			const { roots } = await scan();

			expect(files(roots[0])).toEqual(["init-folder:Lib"]);
		});

		it("should not treat a data file named init as an init script", async () => {
			await write("src/Config/init.json", "src/Config/Other.luau");

			const { roots } = await scan();

			expect(files(roots[0])).toEqual([
				"script:Config/Other.luau",
				"data:Config/init.json",
			]);
		});

		it("should not treat names that merely start with init as init scripts", async () => {
			await write("src/Foo/initialise.luau", "src/Foo/indexer.luau");

			const { roots } = await scan();

			expect(files(roots[0])).toEqual([
				"script:Foo/indexer.luau",
				"script:Foo/initialise.luau",
			]);
		});
	});

	describe("dot-files", () => {
		it("should list dot-files as markers, not entries", async () => {
			await write(
				"src/.shared",
				"src/systems/combat/.server",
				"src/systems/Fight.luau"
			);

			const { roots } = await scan();

			expect(files(roots[0])).toEqual(["script:systems/Fight.luau"]);
			expect(roots[0].markers).toEqual([
				".shared",
				"systems/combat/.server",
			]);
		});

		it("should not list a dot-file inside an excluded directory", async () => {
			await write("src/legacy/.server");

			const { roots } = await scan({ exclude: ["src/legacy"] });

			expect(roots[0].markers).toEqual([]);
		});
	});

	describe("exclude", () => {
		it("should remove matching files", async () => {
			await write("src/Keep.luau", "src/Drop.spec.luau");

			const { roots } = await scan({ exclude: ["**/*.spec.luau"] });

			expect(files(roots[0])).toEqual(["script:Keep.luau"]);
		});

		it("should remove matching directories without visiting them", async () => {
			await write(
				"src/Keep.luau",
				"src/tests/A.luau",
				"src/tests/b/B.luau"
			);

			const { roots } = await scan({ exclude: ["**/tests"] });

			expect(files(roots[0])).toEqual(["script:Keep.luau"]);
		});

		it("should match globs relative to the config's directory", async () => {
			await write("places/main/src/A.luau", "places/main/src/B.luau");

			const { roots } = await scan({
				rootDirs: [abs("places/main/src")],
				configDir: abs("places/main"),
				exclude: ["src/B.luau"],
			});

			expect(files(roots[0])).toEqual(["script:A.luau"]);
		});

		it("should remove an excluded init script before deciding whether the directory is a unit", async () => {
			await write("src/Foo/init.luau", "src/Foo/Bar.luau");

			const { roots } = await scan({ exclude: ["**/init.luau"] });

			expect(files(roots[0])).toEqual(["script:Foo/Bar.luau"]);
		});

		it("should report the top-most excluded paths", async () => {
			await write(
				"src/tests/A.luau",
				"src/tests/b/B.luau",
				"src/X.spec.luau"
			);

			const { roots } = await scan({
				exclude: ["**/tests", "**/*.spec.luau"],
			});

			expect(roots[0].excluded).toEqual(["X.spec.luau", "tests"]);
		});
	});

	describe("several root dirs", () => {
		it("should record which root dir each entry came from, in root order", async () => {
			await write(
				"core/Shared.luau",
				"lobby/Shared.luau",
				"lobby/Only.luau"
			);

			const { roots } = await scan({
				rootDirs: [abs("core"), abs("lobby")],
			});

			expect(roots.map((root) => root.rootDir)).toEqual([
				abs("core"),
				abs("lobby"),
			]);
			expect(roots[0].entries).toEqual([
				{
					kind: "script",
					rootDir: abs("core"),
					relativePath: "Shared.luau",
				},
			]);
			expect(roots[1].entries).toEqual([
				{
					kind: "script",
					rootDir: abs("lobby"),
					relativePath: "Only.luau",
				},
				{
					kind: "script",
					rootDir: abs("lobby"),
					relativePath: "Shared.luau",
				},
			]);
		});

		it("should keep the order the config lists them in, not alphabetical order", async () => {
			await write("b/X.luau", "a/X.luau");

			const { roots } = await scan({ rootDirs: [abs("b"), abs("a")] });

			expect(roots.map((root) => root.rootDir)).toEqual([
				abs("b"),
				abs("a"),
			]);
		});
	});

	describe("missing root dirs", () => {
		it("should warn and contribute nothing", async () => {
			await write("core/A.luau");

			const { roots, warnings } = await scan({
				rootDirs: [abs("core"), abs("lobby")],
			});

			expect(roots[1]).toEqual({
				rootDir: abs("lobby"),
				entries: [],
				markers: [],
				excluded: [],
			});
			expect(files(roots[0])).toEqual(["script:A.luau"]);
			expect(warnings).toMatchObject([
				{
					severity: DiagnosticSeverity.Warning,
					code: "scan.missingRootDir",
					resource: abs("lobby"),
				},
			]);
		});

		it("should not warn when every root dir exists", async () => {
			await write("src/A.luau");

			const { warnings } = await scan();

			expect(warnings).toEqual([]);
		});

		it("should not warn about a root dir that exists but is empty", async () => {
			await fs.createDirectory(abs("src"));

			const { roots, warnings } = await scan();

			expect(roots[0].entries).toEqual([]);
			expect(warnings).toEqual([]);
		});
	});

	describe("indexing", () => {
		it("should read only the index, not the file system", async () => {
			await write("src/A.luau", "src/sub/B.luau");
			const index = newIndex();
			await index.initialize([abs("src")]);
			const readDirectory = jest.spyOn(fs, "readDirectory");

			const result = scanRootDirs(index, {
				rootDirs: [abs("src")],
				exclude: [],
				configDir: abs("."),
			});

			expect(result.roots[0].entries).toHaveLength(2);
			expect(readDirectory).not.toHaveBeenCalled();
		});

		it("should scan one index for several configs with different excludes", async () => {
			await write("src/A.luau", "src/B.luau");
			const index = newIndex();
			await index.initialize([abs("src")]);
			const base = { rootDirs: [abs("src")], configDir: abs(".") };

			const all = scanRootDirs(index, { ...base, exclude: [] });
			const some = scanRootDirs(index, {
				...base,
				exclude: ["**/B.luau"],
			});

			expect(files(all.roots[0])).toEqual([
				"script:A.luau",
				"script:B.luau",
			]);
			expect(files(some.roots[0])).toEqual(["script:A.luau"]);
		});

		it("should see files applied to the index after the initial scan", async () => {
			await write("src/A.luau");
			const index = newIndex();
			await index.initialize([abs("src")]);
			index.applyChanges([
				{
					type: FileChangeType.ADDED,
					path: abs("src/B.luau"),
					fileType: FileType.File,
				},
			]);

			const result = scanRootDirs(index, {
				rootDirs: [abs("src")],
				exclude: [],
				configDir: abs("."),
			});

			expect(files(result.roots[0])).toEqual([
				"script:A.luau",
				"script:B.luau",
			]);
		});
	});
});
