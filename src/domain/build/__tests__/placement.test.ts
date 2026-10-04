import { jest } from "@jest/globals";
import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../../platform/diagnostics/diagnostic.js";
import { FileChangeType } from "../../../platform/fs/file-changes.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { Placement } from "../placement.js";
import { ScannedRoot } from "../root-scanner.js";
import {
	abs,
	builderOf,
	configOf,
	indexOf,
	placeFiles,
	syncTools,
	writeFiles,
} from "./fixtures.js";

describe("Placer", () => {
	const emptyIndex: IndexReader = {
		getEntries: () => undefined,
		hasEntry: () => false,
		getEntryType: () => undefined,
	};

	describe("preparing", () => {
		const prepare = (
			overrides: Parameters<typeof configOf>[0] = {},
			index: IndexReader = emptyIndex
		) => placeFiles(index, configOf(overrides), syncTools);

		it("should root the layout at the output's directory", () => {
			const { layout } = prepare({
				outFile: abs("out/game.project.json"),
			}).unwrap();

			expect(layout.projectDir).toBe(abs("out"));
		});

		it("should hold the template rebased to the output's directory", () => {
			const { template } = prepare({ name: "game" }).unwrap();

			expect(template.edit().getTree()).toEqual({
				name: "game",
				tree: { $className: "DataModel" },
			});
		});
	});

	type ScanOptions = Pick<ResolvedConfig, "rootDirs" | "exclude">;

	const scanRootDirs = (index: IndexReader, options: ScanOptions) =>
		placeFiles(index, configOf(options), syncTools).unwrap();

	const glob = (pattern: string) => toPosix(abs(pattern));

	describe("scanning", () => {
		let fs: MemoryFileSystemService;
		let store: DisposableStore;

		const newIndex = () => new CoreIndexService(fs);

		const scan = async (options: Partial<ScanOptions> = {}) => {
			const scanOptions: ScanOptions = {
				rootDirs: [abs("src")],
				exclude: [],
				...options,
			};
			const index = await newIndex().list(scanOptions.rootDirs);
			const config = configOf(scanOptions);
			const builder = builderOf(fs, index);
			const built = await builder.build(config);
			return {
				roots: builder.place(config).unwrap().roots,
				warnings: built.isOk() ? built.value.warnings : built.error,
			};
		};

		const files = (root: ScannedRoot) =>
			root.entries.map((entry) => `${entry.kind}:${entry.relativePath}`);

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

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
					"src/L.yml"
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
				]);
			});

			it("should record a .meta.json file as meta, not an entry", async () => {
				await write(
					"src/A.luau",
					"src/A.meta.json",
					"src/Inventory/init.meta.json",
					"src/Inventory/B.luau"
				);

				const { roots } = await scan();

				expect(files(roots[0])).toEqual([
					"script:A.luau",
					"script:Inventory/B.luau",
				]);
				expect(roots[0].metaFiles).toEqual([
					"A.meta.json",
					"Inventory/init.meta.json",
				]);
			});

			it("should record an init folder's own init.meta.json and nothing else inside it", async () => {
				await write(
					"src/Bots/init.luau",
					"src/Bots/init.meta.json",
					"src/Bots/Brain.luau",
					"src/Bots/Brain.meta.json"
				);

				const { roots } = await scan();

				expect(roots[0].metaFiles).toEqual(["Bots/init.meta.json"]);
			});

			it("should leave an excluded .meta.json out of the meta files", async () => {
				await write(
					"src/A.luau",
					"src/A.meta.json",
					"src/legacy/init.meta.json"
				);

				const { roots } = await scan({
					exclude: [glob("src/A.meta.json"), glob("src/legacy")],
				});

				expect(roots[0].metaFiles).toEqual([]);
			});

			it("should drop unrecognised extensions", async () => {
				await write(
					"src/A.luau",
					"src/notes.md",
					"src/pack.msgpack",
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

				expect(files(roots[0])).toEqual([
					"script:A.LUAU",
					"model:B.Rbxm",
				]);
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
						source: abs("src/inventory/items/Sword.luau"),
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
				await write(
					"src/Inventory/init.luau",
					"src/Inventory/Helper.luau"
				);

				const { roots } = await scan();

				expect(roots[0].entries).toEqual([
					{
						kind: "init-folder",
						rootDir: abs("src"),
						relativePath: "Inventory",
						source: abs("src/Inventory"),
						initFile: "init.luau",
						members: [
							{
								source: abs("src/Inventory/Helper.luau"),
								below: ["Helper"],
							},
							{
								source: abs("src/Inventory/init.luau"),
								below: [],
							},
						],
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

			it("should scan a dot-file with a file type as an entry", async () => {
				await write(
					"src/.hidden.luau",
					"src/.hidden2.server.luau",
					"src/.eslintrc.json",
					"src/.gitkeep",
					"src/.hidden.meta.json",
					"src/.server"
				);

				const { roots } = await scan();

				expect(files(roots[0])).toEqual([
					"data:.eslintrc.json",
					"script:.hidden.luau",
					"script:.hidden2.server.luau",
				]);
				expect(roots[0].markers).toEqual([".gitkeep", ".server"]);
				expect(roots[0].metaFiles).toEqual([".hidden.meta.json"]);
			});

			it("should not list a dot-file inside an excluded directory", async () => {
				await write("src/legacy/.server");

				const { roots } = await scan({ exclude: [glob("src/legacy")] });

				expect(roots[0].markers).toEqual([]);
			});
		});

		describe("exclude", () => {
			it("should remove matching files", async () => {
				await write("src/Keep.luau", "src/Drop.spec.luau");

				const { roots } = await scan({
					exclude: [glob("**/*.spec.luau")],
				});

				expect(files(roots[0])).toEqual(["script:Keep.luau"]);
			});

			it("should remove matching directories without visiting them", async () => {
				await write(
					"src/Keep.luau",
					"src/tests/A.luau",
					"src/tests/b/B.luau"
				);

				const { roots } = await scan({ exclude: [glob("**/tests")] });

				expect(files(roots[0])).toEqual(["script:Keep.luau"]);
			});

			it("should match globs against absolute paths", async () => {
				await write("places/main/src/A.luau", "places/main/src/B.luau");

				const { roots } = await scan({
					rootDirs: [abs("places/main/src")],
					exclude: [glob("places/main/src/B.luau")],
				});

				expect(files(roots[0])).toEqual(["script:A.luau"]);
			});

			it("should remove an excluded init script before deciding whether the directory is a unit", async () => {
				await write("src/Foo/init.luau", "src/Foo/Bar.luau");

				const { roots } = await scan({
					exclude: [glob("**/init.luau")],
				});

				expect(files(roots[0])).toEqual(["script:Foo/Bar.luau"]);
			});

			it("should report the top-most excluded paths", async () => {
				await write(
					"src/tests/A.luau",
					"src/tests/b/B.luau",
					"src/X.spec.luau"
				);

				const { roots } = await scan({
					exclude: [glob("**/tests"), glob("**/*.spec.luau")],
				});

				expect([...roots[0].leftOut.keys()].sort()).toEqual([
					abs("src/X.spec.luau"),
					abs("src/tests"),
				]);
			});

			it("should name the glob that excluded each path", async () => {
				await write("src/tests/A.luau", "src/X.spec.luau");

				const { roots } = await scan({
					exclude: [glob("**/tests"), glob("**/*.spec.luau")],
				});

				expect(roots[0].leftOut).toEqual(
					new Map([
						[
							abs("src/X.spec.luau"),
							{
								status: "excluded",
								pattern: glob("**/*.spec.luau"),
							},
						],
						[
							abs("src/tests"),
							{ status: "excluded", pattern: glob("**/tests") },
						],
					])
				);
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
						source: abs("core/Shared.luau"),
					},
				]);
				expect(roots[1].entries).toEqual([
					{
						kind: "script",
						rootDir: abs("lobby"),
						relativePath: "Only.luau",
						source: abs("lobby/Only.luau"),
					},
					{
						kind: "script",
						rootDir: abs("lobby"),
						relativePath: "Shared.luau",
						source: abs("lobby/Shared.luau"),
					},
				]);
			});

			it("should keep the order the config lists them in, not alphabetical order", async () => {
				await write("b/X.luau", "a/X.luau");

				const { roots } = await scan({
					rootDirs: [abs("b"), abs("a")],
				});

				expect(roots.map((root) => root.rootDir)).toEqual([
					abs("b"),
					abs("a"),
				]);
			});
		});

		describe("linked directories", () => {
			it("should scan a linked directory under its link path", async () => {
				await write("shared/Util.luau", "shared/deep/Deep.luau");
				await fs.createSymbolicLink(abs("shared"), abs("src/Shared"));

				const { roots, warnings } = await scan();

				expect(roots[0].rootDir).toBe(abs("src"));
				expect(files(roots[0])).toEqual([
					"script:Shared/Util.luau",
					"script:Shared/deep/Deep.luau",
				]);
				expect(warnings).toEqual([]);
			});

			it("should place a linked file like the file it points at", async () => {
				await write("shared/Util.luau");
				await fs.createSymbolicLink(
					abs("shared/Util.luau"),
					abs("src/U.luau")
				);

				const { roots } = await scan();

				expect(files(roots[0])).toEqual(["script:U.luau"]);
			});

			it("should treat a linked directory with an init script as an init folder", async () => {
				await write("shared/Pkg/init.luau");
				await fs.createSymbolicLink(abs("shared/Pkg"), abs("src/Pkg"));

				const { roots } = await scan();

				expect(roots[0].entries).toEqual([
					{
						kind: "init-folder",
						rootDir: abs("src"),
						relativePath: "Pkg",
						source: abs("src/Pkg"),
						initFile: "init.luau",
						members: [
							{ source: abs("src/Pkg/init.luau"), below: [] },
						],
					},
				]);
			});

			it("should scan two links to one target as two copies", async () => {
				await write("shared/Util.luau");
				await fs.createSymbolicLink(abs("shared"), abs("src/One"));
				await fs.createSymbolicLink(abs("shared"), abs("src/Two"));

				const { roots } = await scan();

				expect(files(roots[0])).toEqual([
					"script:One/Util.luau",
					"script:Two/Util.luau",
				]);
			});

			it("should match exclude globs against the link path", async () => {
				await write("shared/Util.luau", "shared/Util.spec.luau");
				await fs.createSymbolicLink(abs("shared"), abs("src/Shared"));

				const { roots } = await scan({
					exclude: [glob("src/Shared/*.spec.luau")],
				});

				expect(files(roots[0])).toEqual(["script:Shared/Util.luau"]);
				expect([...roots[0].leftOut.keys()]).toEqual([
					abs("src/Shared/Util.spec.luau"),
				]);
			});

			it("should not read what an excluded link points at", async () => {
				await write("shared/Util.luau");
				await fs.createSymbolicLink(abs("shared"), abs("src/Shared"));

				const { roots, warnings } = await scan({
					exclude: [glob("src/Shared")],
				});

				expect(roots[0].entries).toEqual([]);
				expect([...roots[0].leftOut.keys()]).toEqual([
					abs("src/Shared"),
				]);
				expect(warnings).toEqual([]);
			});

			it("should skip a link to nothing with a warning naming the link", async () => {
				await write("src/A.luau");
				await fs.createSymbolicLink(abs("missing"), abs("src/Broken"));

				const { roots, warnings } = await scan();

				expect(files(roots[0])).toEqual(["script:A.luau"]);
				expect(roots[0].leftOut).toEqual(
					new Map([[abs("src/Broken"), { status: "skipped" }]])
				);
				expect(warnings).toMatchObject([
					{
						severity: DiagnosticSeverity.Warning,
						code: "scan.unresolvedLink",
						resource: abs("src/Broken"),
					},
				]);
			});

			it("should skip a link to its own ancestor with one warning", async () => {
				await write("src/A.luau");
				await fs.createSymbolicLink(abs("src"), abs("src/Loop"));

				const { roots, warnings } = await scan();

				expect(files(roots[0])).toEqual(["script:A.luau"]);
				expect(roots[0].leftOut).toEqual(
					new Map([[abs("src/Loop"), { status: "skipped" }]])
				);
				expect(warnings).toMatchObject([
					{ code: "scan.unresolvedLink", resource: abs("src/Loop") },
				]);
			});

			it("should warn once about a link that two overlapping root dirs both reach", async () => {
				await write("src/inner/A.luau");
				await fs.createSymbolicLink(
					abs("missing"),
					abs("src/inner/Broken")
				);

				const { warnings } = await scan({
					rootDirs: [abs("src"), abs("src/inner")],
				});

				expect(warnings).toHaveLength(1);
			});

			it("should skip a link that points above its root dir", async () => {
				await write("src/A.luau");
				await fs.createSymbolicLink(abs("."), abs("src/Up"));

				const { roots, warnings } = await scan();

				expect(files(roots[0])).toEqual(["script:A.luau"]);
				expect(warnings).toMatchObject([
					{ code: "scan.unresolvedLink", resource: abs("src/Up") },
				]);
			});
		});

		describe("missing root dirs", () => {
			it("should warn and contribute nothing", async () => {
				await write("core/A.luau");

				const { roots, warnings } = await scan({
					rootDirs: [abs("core"), abs("lobby")],
				});

				expect(roots[1]).toMatchObject({
					rootDir: abs("lobby"),
					exists: false,
					entries: [],
					markers: [],
					metaFiles: [],
					leftOut: new Map(),
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
				const index = await newIndex().list([abs("src")]);
				const readDirectory = jest.spyOn(fs, "readDirectory");

				const result = scanRootDirs(index, {
					rootDirs: [abs("src")],
					exclude: [],
				});

				expect(result.roots[0].entries).toHaveLength(2);
				expect(readDirectory).not.toHaveBeenCalled();
			});

			it("should scan one index for several configs with different excludes", async () => {
				await write("src/A.luau", "src/B.luau");
				const index = await newIndex().list([abs("src")]);
				const base = { rootDirs: [abs("src")] };

				const all = scanRootDirs(index, { ...base, exclude: [] });
				const some = scanRootDirs(index, {
					...base,
					exclude: [glob("**/B.luau")],
				});

				expect(files(all.roots[0])).toEqual([
					"script:A.luau",
					"script:B.luau",
				]);
				expect(files(some.roots[0])).toEqual(["script:A.luau"]);
			});

			it("should see files applied to the index after the initial scan", async () => {
				await write("src/A.luau");
				const listed = await newIndex().list([abs("src")]);
				await write("src/B.luau");
				const index = await newIndex().update(listed, [
					{
						type: FileChangeType.ADDED,
						path: abs("src/B.luau"),
						fileType: FileType.File,
					},
				]);

				const result = scanRootDirs(index, {
					rootDirs: [abs("src")],
					exclude: [],
				});

				expect(files(result.roots[0])).toEqual([
					"script:A.luau",
					"script:B.luau",
				]);
			});
		});
	});

	const at = (...segments: string[]) => toPosix(abs(...segments));

	describe("reading", () => {
		let fs: MemoryFileSystemService;
		let store: DisposableStore;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const read = async (overrides: ResolvedConfigSpec = {}) => {
			const config = configOf({
				routes: {
					server: "ServerScriptService",
					"*": "ReplicatedStorage",
				},
				variants: { mock: true },
				...overrides,
			});
			const index = await indexOf(store, fs, config.rootDirs);
			return placeFiles(index, config, syncTools).unwrap().readings;
		};

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		describe("folders", () => {
			it("should classify each folder above an entry, outermost first", async () => {
				await write("src/server/(Hidden)/mock/Inventory/Save.luau");

				const { entries } = await read();
				const entry = entries.get(
					at("src/server/(Hidden)/mock/Inventory/Save.luau")
				);

				expect(
					entry?.folders.map(({ segment, kind, invisible, dir }) => ({
						segment,
						kind,
						invisible,
						dir,
					}))
				).toEqual([
					{
						segment: "server",
						kind: "route",
						invisible: false,
						dir: "server",
					},
					{
						segment: "(Hidden)",
						kind: "plain",
						invisible: true,
						dir: "server/(Hidden)",
					},
					{
						segment: "mock",
						kind: "variant",
						invisible: false,
						dir: "server/(Hidden)/mock",
					},
					{
						segment: "Inventory",
						kind: "plain",
						invisible: false,
						dir: "server/(Hidden)/mock/Inventory",
					},
				]);
			});

			it("should read a folder shared by many entries once", async () => {
				await write("src/Inventory/A.luau", "src/Inventory/B.luau");

				const { entries } = await read();

				expect(
					entries.get(at("src/Inventory/A.luau"))?.folders[0]
				).toBe(entries.get(at("src/Inventory/B.luau"))?.folders[0]);
			});

			it("should read a folder that only holds meta", async () => {
				await write("src/Empty/init.meta.json");

				const { folders } = await read();

				expect(folders.get(at("src/Empty"))).toMatchObject({
					kind: "plain",
					segment: "Empty",
				});
			});

			it("should note a plain folder that only differs from a key in case", async () => {
				await write("src/SERVER/Save.luau", "src/Inventory/Save.luau");

				const { folders } = await read();

				expect(folders.get(at("src/SERVER"))?.nearMissKey).toBe(
					"server"
				);
				expect(
					folders.get(at("src/Inventory"))?.nearMissKey
				).toBeUndefined();
			});
		});

		describe("markers", () => {
			it("should read the key a marker declares", async () => {
				await write("src/.server", "src/.mock", "src/.other");

				const { markers } = await read();

				expect(markers.get(at("src/.server"))?.key).toBe("server");
				expect(markers.get(at("src/.mock"))?.key).toBe("mock");
				expect(markers.get(at("src/.other"))?.key).toBeUndefined();
			});

			it("should note a marker that only differs from a key in case", async () => {
				await write("src/.SERVER", "src/Save.luau");

				const { markers } = await read();

				expect(markers.get(at("src/.SERVER"))).toEqual({
					key: undefined,
					nearMissKey: "server",
				});
			});
		});

		describe("entries", () => {
			it("should read the suffixes of a file's stem", async () => {
				await write("src/Save.mock.server.luau");

				const { entries } = await read();
				const entry = entries.get(at("src/Save.mock.server.luau"));

				expect(entry).toMatchObject({
					fileName: "Save.mock.server.luau",
					kind: "script",
				});
				expect(entry?.match.spans.map(({ key }) => key)).toEqual([
					"server",
					"mock",
				]);
			});

			it("should read an init folder through its init file", async () => {
				await write("src/Inventory/init.server.luau");

				const { entries } = await read();
				const entry = entries.get(at("src/Inventory"));

				expect(entry).toMatchObject({
					fileName: "init.server.luau",
					kind: "script",
				});
				expect(entry?.match.matchedKeys).toEqual(new Set(["server"]));
			});

			it("should note an @ that matches no route, with the closest one", async () => {
				await write("src/Save@sever.luau");

				const { entries } = await read();

				expect(
					entries.get(at("src/Save@sever.luau"))?.match.strayAt
				).toMatchObject({ text: "sever", closestKey: "server" });
			});

			it("should read a data file without its .json suffix", async () => {
				await write("src/Config.server.json");

				const { entries } = await read();
				const entry = entries.get(at("src/Config.server.json"));

				expect(entry?.kind).toBe("data");
				expect(entry?.match.matchedKeys).toEqual(new Set(["server"]));
			});
		});
	});

	const ROUTES = {
		ReplicatedFirst: "ReplicatedFirst",
		server: "ServerScriptService",
		client: "StarterPlayer/StarterPlayerScripts",
		"*": "ReplicatedStorage/shared",
	};

	describe("routing", () => {
		let fs: MemoryFileSystemService;
		let store: DisposableStore;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const route = async (
			overrides: ResolvedConfigSpec = {},
			rootDirs: readonly string[] = [abs("src")]
		) => {
			const config = configOf({
				routes: ROUTES,
				rootDirs: [...rootDirs],
				...overrides,
			});
			const index = await indexOf(store, fs, rootDirs);
			const builder = builderOf(fs, index);
			const built = await builder.build(config);
			return built.map(({ warnings }) => {
				const placement = builder.place(config).unwrap();
				return {
					routed: placement.routed,
					leftOut: placement.leftOut,
					unrouted: placement.leftOut
						.withStatus("unrouted")
						.map(([source]) => source),
					warnings,
				};
			});
		};

		const paths = async (
			overrides: ResolvedConfigSpec = {},
			rootDirs?: readonly string[]
		) =>
			(await route(overrides, rootDirs))
				.unwrap()
				.routed.map((file) => file.instancePath.join("/"));

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		describe("folder nodes", () => {
			it("should pair each node a folder names with that folder, skipping routing, variant and invisible folders", async () => {
				await write("src/Combat/(group)/server/dev/Moves/Punch.luau");

				const [file] = (
					await route({ variants: { dev: true } })
				).unwrap().routed;

				expect(file.instancePath).toEqual([
					"ServerScriptService",
					"Combat",
					"Moves",
					"Punch",
				]);
				expect(file.folderNodes).toEqual([
					{
						instancePath: ["ServerScriptService", "Combat"],
						dir: "Combat",
					},
					{
						instancePath: [
							"ServerScriptService",
							"Combat",
							"Moves",
						],
						dir: "Combat/(group)/server/dev/Moves",
					},
				]);
			});

			it("should place folder nodes below the route target's own folders", async () => {
				await write("src/Inventory/Types.luau");

				const [file] = (await route()).unwrap().routed;

				expect(file.folderNodes).toEqual([
					{
						instancePath: [
							"ReplicatedStorage",
							"shared",
							"Inventory",
						],
						dir: "Inventory",
					},
				]);
			});
		});

		describe("governing route", () => {
			it("should let a route folder outside a suffix govern, and ignore the suffix", async () => {
				await write("src/ReplicatedFirst/main.client.luau");

				expect(await paths()).toEqual(["ReplicatedFirst/main"]);
			});

			it("should route by suffix when nothing above the file routes", async () => {
				await write("src/Inventory/Hud.client.luau");

				expect(await paths()).toEqual([
					"StarterPlayer/StarterPlayerScripts/Inventory/Hud",
				]);
			});

			it("should strip an @key suffix, and leave a ModuleScript a ModuleScript", async () => {
				await write(
					"src/Inventory/Save@server.luau",
					"src/Inventory/Load@client.luau"
				);

				expect(await paths()).toEqual([
					"StarterPlayer/StarterPlayerScripts/Inventory/Load",
					"ServerScriptService/Inventory/Save",
				]);
			});

			it("should not route by -, _, + or a capital letter", async () => {
				await write(
					"src/Inventory/Combat-server.luau",
					"src/Inventory/Load_server.luau",
					"src/Inventory/Save+server.luau",
					"src/Inventory/PlayerServer.luau",
					"src/Net/HttpClient.luau"
				);

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Combat-server",
					"ReplicatedStorage/shared/Inventory/Load_server",
					"ReplicatedStorage/shared/Inventory/PlayerServer",
					"ReplicatedStorage/shared/Inventory/Save+server",
					"ReplicatedStorage/shared/Net/HttpClient",
				]);
			});

			it("should not route .shared, which belongs to Rojo", async () => {
				await write("src/Types.shared.luau");

				expect(
					await paths({
						routes: {
							shared: "ReplicatedStorage",
							"*": "Workspace",
						},
					})
				).toEqual(["Workspace/Types.shared"]);
			});

			it("should not strip a suffix whose letter case differs beyond the first letter", async () => {
				await write(
					"src/Inventory/Load@SERVER.luau",
					"src/Inventory/Saveserver.luau"
				);

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Load@SERVER",
					"ReplicatedStorage/shared/Inventory/Saveserver",
				]);
			});

			it("should match a suffix with the first letter of the key in either case", async () => {
				await write(
					"src/Inventory/Load@Server.luau",
					"src/Inventory/Save@Client.luau"
				);

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Load",
					"StarterPlayer/StarterPlayerScripts/Inventory/Save",
				]);
			});

			it("should match a lower-case folder and marker against a key declared with a capital", async () => {
				await write(
					"src/server/A.luau",
					"src/Inventory/.server",
					"src/Inventory/B.luau"
				);

				expect(
					await paths({
						routes: {
							Server: "ServerScriptService",
							"*": "Workspace",
						},
					})
				).toEqual([
					"ServerScriptService/Inventory/B",
					"ServerScriptService/A",
				]);
			});

			it("should remove a routing folder and route below it", async () => {
				await write("src/Inventory/server/Save.luau");

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Save",
				]);
			});

			it("should keep a nested route folder as an ordinary folder", async () => {
				await write("src/ReplicatedFirst/client/main.luau");

				expect(await paths()).toEqual(["ReplicatedFirst/client/main"]);
			});

			it("should keep a nested Name@key folder under its written name", async () => {
				await write("src/ReplicatedFirst/Queue@client/main.luau");

				expect(await paths()).toEqual([
					"ReplicatedFirst/Queue@client/main",
				]);
			});

			it("should still hide a nested invisible routing folder", async () => {
				await write("src/ReplicatedFirst/(server)/main.luau");

				expect(await paths()).toEqual(["ReplicatedFirst/main"]);
			});

			it("should let only the governing marker act", async () => {
				await write(
					"src/ReplicatedFirst/Net/.server",
					"src/ReplicatedFirst/Net/main.luau"
				);

				expect(await paths()).toEqual(["ReplicatedFirst/Net/main"]);
			});

			it("should ignore a suffix under an outer routing folder", async () => {
				await write("src/server/Inventory/Hud.client.luau");

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Hud",
				]);
			});

			it("should ignore a suffix Rojo doesn't understand but leave it in the name", async () => {
				await write("src/server/Hud-client.luau");

				expect(await paths()).toEqual([
					"ServerScriptService/Hud-client",
				]);
			});

			it("should match routing folders and markers with the first letter in either case", async () => {
				await write("src/Server/Save.luau");

				expect(await paths()).toEqual(["ServerScriptService/Save"]);
			});

			it("should treat routing folders that differ beyond the first letter as ordinary", async () => {
				await write("src/SERVER/Save.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/SERVER/Save",
				]);
			});

			it("should only walk from each file's own root dir", async () => {
				await write("places/server/lobby/Hud.luau");

				expect(await paths({}, [abs("places/server/lobby")])).toEqual([
					"ReplicatedStorage/shared/Hud",
				]);
			});

			it("should not treat the root dir's own name as a routing folder", async () => {
				await write("server/Save.luau");

				expect(await paths({}, [abs("server")])).toEqual([
					"ReplicatedStorage/shared/Save",
				]);
			});
		});

		describe("marker files", () => {
			it("should route a folder and everything below it, keeping the folder name", async () => {
				await write(
					"src/Inventory/.server",
					"src/Inventory/Save.luau",
					"src/Inventory/deep/Load.luau"
				);

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Save",
					"ServerScriptService/Inventory/deep/Load",
				]);
			});

			it("should route everything under a marker in the root dir", async () => {
				await write("src/.server", "src/Save.luau");

				expect(await paths()).toEqual(["ServerScriptService/Save"]);
			});

			it("should let an outer marker beat a nested marker", async () => {
				await write(
					"src/Inventory/.server",
					"src/Inventory/inner/.client",
					"src/Inventory/inner/Hud.luau"
				);

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/inner/Hud",
				]);
			});

			it("should let a folder's name beat its own marker", async () => {
				await write("src/server/.client", "src/server/Save.luau");

				expect(await paths()).toEqual(["ServerScriptService/Save"]);
			});

			it("should ignore dot-files that aren't declared routes", async () => {
				await write("src/.gitkeep", "src/.mock", "src/Save.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Save",
				]);
			});
		});

		describe("invisible folders", () => {
			it("should treat an invisible folder named after a route as a routing folder", async () => {
				await write("src/Inventory/(server)/Save.luau");

				expect(await paths()).toEqual([
					"ServerScriptService/Inventory/Save",
				]);
			});

			it("should treat an invisible folder named after a variant as a variant folder", async () => {
				await write("src/Analytics/(mock)/Service.luau");

				const [file] = (
					await route({ variants: { mock: true } })
				).unwrap().routed;

				expect(file.instancePath).toEqual([
					"ReplicatedStorage",
					"shared",
					"Analytics",
					"Service",
				]);
				expect(file.variants).toEqual([
					{ variant: "mock", form: "folder" },
				]);
			});

			it("should drop an invisible folder from the path", async () => {
				await write("src/Inventory/(internal)/Save.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Save",
				]);
			});
		});

		describe("letter case mismatches", () => {
			const caseWarnings = async (overrides: ResolvedConfigSpec = {}) =>
				(await route(overrides))
					.unwrap()
					.warnings.filter(
						({ code }) => code === "route.caseMismatch"
					);

			it("should warn about a folder named like a route in different case, at that folder", async () => {
				await write("src/SERVER/Save.luau");

				const [warning] = await caseWarnings();

				expect(warning).toMatchObject({
					severity: DiagnosticSeverity.Warning,
					resource: abs("src/SERVER"),
				});
				expect(warning.message).toContain('"server"');
				expect(warning.message).toContain(
					'Spell it "server" or "Server"'
				);
			});

			it("should warn about an invisible folder named like a variant in different case", async () => {
				await write("src/Analytics/(MOCK)/Service.luau");

				const [warning] = await caseWarnings({
					variants: { mock: true },
				});

				expect(warning.resource).toBe(abs("src/Analytics/(MOCK)"));
				expect(warning.message).toContain('variant "mock"');
			});

			it("should warn about a marker file named like a route in different case", async () => {
				await write("src/Inventory/.SERVER", "src/Inventory/Save.luau");

				const [warning] = await caseWarnings();

				expect(warning.resource).toBe(abs("src/Inventory/.SERVER"));
				expect(warning.message).toContain('route "server"');
			});

			it("should warn once for a folder however many files it holds", async () => {
				await write("src/SERVER/A.luau", "src/SERVER/B.luau");

				expect(await caseWarnings()).toHaveLength(1);
			});

			it("should warn once per mismatched name", async () => {
				await write(
					"src/SERVER/A.luau",
					"src/Inventory/.CLIENT",
					"src/CLIENT/B.luau"
				);

				const warnings = await caseWarnings();

				expect(warnings.map(({ resource }) => resource).sort()).toEqual(
					[
						abs("src/CLIENT"),
						abs("src/Inventory/.CLIENT"),
						abs("src/SERVER"),
					]
				);
			});

			it("should not warn about a name that only differs in its first letter", async () => {
				await write(
					"src/Server/Save.luau",
					"src/Inventory/.Client",
					"src/Inventory/Load@Server.luau"
				);

				expect(await caseWarnings()).toEqual([]);
			});

			it("should not warn about a name that matches exactly or not at all", async () => {
				await write(
					"src/server/A.luau",
					"src/Inventory/B.server.luau",
					"src/Inventory/HTTPServer.luau",
					"src/Inventory/Player.luau"
				);

				expect(await caseWarnings()).toEqual([]);
			});

			it("should still report a mismatch on a file that no route governs", async () => {
				await write("src/SERVER/Save.luau");

				const warnings = (
					await route({ routes: { server: "ServerScriptService" } })
				).unwrap().warnings;

				expect(warnings.map(({ code }) => code)).toEqual([
					"route.caseMismatch",
					"route.unrouted",
				]);
			});
		});

		describe("@ that routes nowhere", () => {
			const strayWarnings = async () =>
				(await route())
					.unwrap()
					.warnings.filter(({ code }) => code === "route.strayAt");

			it("should warn once for every file and folder, naming the closest route", async () => {
				await write(
					"src/Inventory/Save@sever.luau",
					"src/Queue@clent/Load.luau",
					"src/Inventory/Fine@server.luau"
				);

				const [warning, ...others] = await strayWarnings();

				expect(others).toEqual([]);
				expect(warning.severity).toBe(DiagnosticSeverity.Warning);
				expect(warning.resource).toBe(abs("default.rogen.json"));
				expect(warning.message).toContain("2 names have");
				expect(warning.message).toContain(
					`${abs("src/Inventory/Save@sever.luau")} (did you mean "@server"?)`
				);
				expect(warning.message).toContain(
					`${abs("src/Queue@clent")} (did you mean "@client"?)`
				);
				expect(warning.message).not.toContain("Fine@server");
			});

			it("should say when a declared route isn't at the end of the name", async () => {
				await write("src/Save@server.bak.luau");

				const [warning] = await strayWarnings();

				expect(warning.message).toContain(
					'"@server" must end the name'
				);
			});

			it("should list the first few and count the rest", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, index) => `src/Save${index}@sever.luau`
					)
				);

				const [warning] = await strayWarnings();

				expect(warning.message).toContain("12 names have");
				expect(warning.message).toContain("2 more like it");
			});

			it("should not warn for a route that an outer route ignores", async () => {
				await write("src/server/Net/Save@client.luau");

				expect(await strayWarnings()).toEqual([]);
			});
		});

		describe("paths the template mounts", () => {
			const mounting = (...mounts: [string, string][]) => ({
				template: {
					file: abs("template.project.json"),
					project: {
						name: "game",
						tree: {
							$className: "DataModel",
							ReplicatedStorage: Object.fromEntries(
								mounts.map(([name, target]) => [
									name,
									{ $path: target },
								])
							),
						},
					},
				},
			});

			it("should leave a mounted folder out of the scan, saying which node mounts it", async () => {
				await write(
					"src/Vendor/Lib/Server/Thing.luau",
					"src/Vendor/Lib@sever.luau",
					"src/Inventory/Save.luau"
				);

				const result = (
					await route(mounting(["Vendor", "src/Vendor"]))
				).unwrap();

				expect(
					result.routed.map((file) => file.instancePath.join("/"))
				).toEqual(["ReplicatedStorage/shared/Inventory/Save"]);
				expect(result.leftOut.get(abs("src/Vendor"))).toEqual({
					status: "mounted",
					node: ["ReplicatedStorage", "Vendor"],
				});
				expect(result.warnings).toEqual([]);
			});

			it("should leave out a single mounted file", async () => {
				await write("src/Config.json", "src/Save.luau");

				const result = (
					await route(mounting(["Config", "src/Config.json"]))
				).unwrap();

				expect(
					result.routed.map((file) => file.instancePath.join("/"))
				).toEqual(["ReplicatedStorage/shared/Save"]);
			});

			it("should take a mounted path relative to the template's directory", async () => {
				await write("src/Vendor/Lib.luau", "src/Save.luau");
				const config = mounting(["Vendor", "../src/Vendor"]);

				const result = (
					await route({
						template: {
							...config.template,
							file: abs("templates/template.project.json"),
						},
					})
				).unwrap();

				expect(result.leftOut.get(abs("src/Vendor"))).toMatchObject({
					status: "mounted",
				});
			});

			it("should leave a mount outside every root dir alone", async () => {
				await write("src/Save.luau");

				const result = (
					await route(mounting(["Packages", "Packages"]))
				).unwrap();

				expect(result.routed).toHaveLength(1);
			});

			it("should fail when the template mounts a root dir or a folder above one", async () => {
				await write("src/Save.luau");

				for (const target of ["src", "."]) {
					const result = await route(mounting(["All", target]));

					expect(result.isErr()).toBe(true);
					expect(
						result.isErr() &&
							result.error.diagnostics.map(({ code }) => code)
					).toEqual(["template.mountsRootDir"]);
				}
			});
		});

		describe("scripts that never run", () => {
			const dead = async (overrides: ResolvedConfigSpec = {}) =>
				(
					await route({
						routes: {
							...ROUTES,
							shared: "ReplicatedStorage/shared",
						},
						...overrides,
					})
				)
					.unwrap()
					.warnings.filter(({ code }) => code === "tree.deadScript");

			it("should warn once for a LocalScript in a server service and a Script in a replicating one", async () => {
				await write(
					"src/server/Hud.client.luau",
					"src/shared/Secret.server.luau",
					"src/server/Boot.server.luau",
					"src/client/Main.client.luau",
					"src/ReplicatedFirst/Load.client.luau",
					"src/Types.luau"
				);

				const [warning, ...others] = await dead();

				expect(others).toEqual([]);
				expect(warning.message).toContain("2 scripts will never run");
				expect(warning.message).toContain(
					`${abs("src/server/Hud.client.luau")} -> ServerScriptService/Hud (a LocalScript, placed by the "server" route)`
				);
				expect(warning.message).toContain(
					`${abs("src/shared/Secret.server.luau")} -> ReplicatedStorage/shared/Secret (a Script, placed by the "shared" route)`
				);
			});

			const metaWith = (runContext: string) =>
				JSON.stringify({ properties: { RunContext: runContext } });

			it("should not warn about a Script whose meta sets a run context, which runs by that", async () => {
				await write("src/shared/Hud.server.luau");
				await fs.writeFile(
					abs("src/shared/Hud.meta.json"),
					metaWith("Client")
				);

				expect(await dead()).toEqual([]);
			});

			it("should not warn about an init folder's Script whose meta sets a run context", async () => {
				await write("src/shared/Net/init.server.luau");
				await fs.writeFile(
					abs("src/shared/Net/init.meta.json"),
					metaWith("Server")
				);

				expect(await dead()).toEqual([]);
			});

			it("should still warn when the meta sets the Legacy run context or is invalid", async () => {
				await write(
					"src/shared/A.server.luau",
					"src/shared/B.server.luau"
				);
				await fs.writeFile(
					abs("src/shared/A.meta.json"),
					metaWith("Legacy")
				);
				await fs.writeFile(abs("src/shared/B.meta.json"), "{ nope");

				expect((await dead())[0].message).toContain("2 scripts");
			});

			it("should warn about an init folder's script", async () => {
				await write("src/shared/Net/init.server.luau");

				expect((await dead())[0].message).toContain("1 script will");
			});

			it("should not warn about a ModuleScript or a script that is pruned", async () => {
				await write(
					"src/server/Hud.client.mock.luau",
					"src/server/Save@client.luau"
				);

				expect(await dead({ variants: { mock: false } })).toEqual([]);
			});

			it("should list the first few and count the rest", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, index) => `src/shared/Save${index}.server.luau`
					)
				);

				expect((await dead())[0].message).toContain("2 more like it");
			});
		});

		describe("variant typos", () => {
			const typos = async () =>
				(await route({ variants: { mock: true } }))
					.unwrap()
					.warnings.filter(({ code }) => code === "variant.typo");

			it("should warn once, naming the variant a dot part is one edit from", async () => {
				await write(
					"src/Analytics.mok.luau",
					"src/Save.spec.luau",
					"src/Fine.mock.luau"
				);

				const [warning, ...others] = await typos();

				expect(others).toEqual([]);
				expect(warning.resource).toBe(abs("default.rogen.json"));
				expect(warning.message).toContain(
					`${abs("src/Analytics.mok.luau")} (did you mean ".mock" for ".mok"?)`
				);
				expect(warning.message).not.toContain("spec");
			});
		});

		describe("server code that ships to clients", () => {
			const shipped = async () =>
				(await route())
					.unwrap()
					.warnings.filter(
						({ code }) => code === "route.serverCodeShipped"
					);

			it("should warn once, naming each file, the route it sits under and the one that governs it", async () => {
				await write(
					"src/ReplicatedFirst/server/Datastore.luau",
					"src/ReplicatedFirst/Other@server/Save.luau",
					"src/server/Net/Fine.luau"
				);

				const [warning, ...others] = await shipped();

				expect(others).toEqual([]);
				expect(warning.severity).toBe(DiagnosticSeverity.Warning);
				expect(warning.resource).toBe(abs("default.rogen.json"));
				expect(warning.message).toBe(
					[
						'2 files under a "server" route ship to clients, because "ReplicatedFirst" governs them:',
						`  ${abs("src/ReplicatedFirst/Other@server/Save.luau")} -> ReplicatedFirst/Other@server/Save`,
						`  ${abs("src/ReplicatedFirst/server/Datastore.luau")} -> ReplicatedFirst/server/Datastore`,
						"Move them out of the \"ReplicatedFirst\" route's files if they're server code.",
					].join("\n")
				);
			});

			it("should warn for a data file and a suffix that an outer route ignores", async () => {
				await write(
					"src/ReplicatedFirst/Config@server.json",
					"src/ReplicatedFirst/Rules@server.luau"
				);

				expect((await shipped())[0].message).toContain("2 files");
			});

			it("should not warn when the governing route is server-only too", async () => {
				await write("src/server/Net/client/Save.luau");

				expect(await shipped()).toEqual([]);
			});

			it("should not warn about a Script, whose source stays on the server", async () => {
				await write("src/ReplicatedFirst/server/Boot.server.luau");

				expect(await shipped()).toEqual([]);
			});

			it("should not warn about a route that targets a replicating service", async () => {
				await write("src/ReplicatedFirst/client/Hud.luau");

				expect(await shipped()).toEqual([]);
			});

			it("should list the first few files and count the rest", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, index) =>
							`src/ReplicatedFirst/server/Save${index}.luau`
					)
				);

				const [warning] = await shipped();

				expect(warning.message).toContain("12 files");
				expect(warning.message).toContain("2 more like it");
			});

			it("should not warn about a file a dormant variant prunes", async () => {
				await write("src/ReplicatedFirst/server/Save.mock.luau");

				const [warning] = await (async () =>
					(await route({ variants: { mock: false } }))
						.unwrap()
						.warnings.filter(
							({ code }) => code === "route.serverCodeShipped"
						))();

				expect(warning).toBeUndefined();
			});
		});

		describe("targets", () => {
			it("should create every folder of a nested target", async () => {
				await write("src/Hud.client.luau");

				expect(await paths()).toEqual([
					"StarterPlayer/StarterPlayerScripts/Hud",
				]);
			});

			it("should place files at the service root for a bare service target", async () => {
				await write("src/server/Save.luau");

				expect(await paths()).toEqual(["ServerScriptService/Save"]);
			});

			it("should apply the * route when nothing else does", async () => {
				await write("src/Inventory/Types.luau");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Types",
				]);
			});
		});

		describe("suffixes and stacked keys", () => {
			it("should route a script whose route suffix is followed by a variant", async () => {
				await write("src/Foo.server.mock.luau");

				const result = await route({ variants: { mock: true } });

				expect(
					result.unwrap().routed.map((file) => file.instancePath)
				).toEqual([["ServerScriptService", "Foo"]]);
			});

			it("should strip a variant suffix from the name", async () => {
				await write("src/Foo.mock.server.luau");

				const result = await route({ variants: { mock: true } });

				expect(
					result.unwrap().routed.map((file) => file.instancePath)
				).toEqual([["ServerScriptService", "Foo"]]);
			});

			it("should route models and data files by suffix and strip it", async () => {
				await write("src/Gun.server.rbxm", "src/Data.client.json");

				expect(await paths()).toEqual([
					"StarterPlayer/StarterPlayerScripts/Data",
					"ServerScriptService/Gun",
				]);
			});

			it("should route a .model.json file by a suffix before .model", async () => {
				await write("src/Gun.server.model.json");

				expect(await paths()).toEqual(["ServerScriptService/Gun"]);
			});

			it("should strip a variant suffix before .model from the name", async () => {
				await write("src/Gun.mock.model.json");

				const result = await route({ variants: { mock: true } });

				expect(
					result.unwrap().routed.map((file) => file.instancePath)
				).toEqual([["ReplicatedStorage", "shared", "Gun"]]);
				expect(result.unwrap().routed[0].variants).toMatchObject([
					{ variant: "mock" },
				]);
			});

			it("should name a nested project file after the part before .project", async () => {
				await write("src/Outer.project.json");

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Outer",
				]);
			});

			it("should leave an ignored suffix on a model in its Rojo name", async () => {
				await write("src/server/Gun.client.rbxm");

				expect(await paths()).toEqual([
					"ServerScriptService/Gun.client",
				]);
			});

			it("should not route on a variant alone", async () => {
				await write("src/Foo.mock.luau");

				expect(await paths({ variants: { mock: true } })).toEqual([
					"ReplicatedStorage/shared/Foo",
				]);
			});

			it("should leave an undeclared suffix in the name", async () => {
				await write("src/Foo.beta.luau");

				expect(await paths({ variants: { mock: true } })).toEqual([
					"ReplicatedStorage/shared/Foo.beta",
				]);
			});
		});

		describe("variants", () => {
			const variantsOf = async (
				overrides: ResolvedConfigSpec = { variants: { mock: true } }
			) =>
				(await route(overrides))
					.unwrap()
					.routed.map((file) => file.variants);

			it("should remove a variant folder from the path", async () => {
				await write("src/Analytics/mock/Service.luau");

				const [file] = (
					await route({ variants: { mock: true } })
				).unwrap().routed;

				expect(file.instancePath).toEqual([
					"ReplicatedStorage",
					"shared",
					"Analytics",
					"Service",
				]);
				expect(file.variants).toEqual([
					{ variant: "mock", form: "folder" },
				]);
			});

			it("should keep a folder that a variant marker applies to", async () => {
				await write(
					"src/Experimental/.mock",
					"src/Experimental/Save.luau"
				);

				const [file] = (
					await route({ variants: { mock: true } })
				).unwrap().routed;

				expect(file.instancePath).toEqual([
					"ReplicatedStorage",
					"shared",
					"Experimental",
					"Save",
				]);
				expect(file.variants).toEqual([
					{ variant: "mock", form: "marker" },
				]);
			});

			it("should apply a marker in the root dir to every file", async () => {
				await write("src/.mock", "src/A/B.luau");

				expect(await variantsOf()).toEqual([
					[{ variant: "mock", form: "marker" }],
				]);
			});

			it("should record how a suffix matched", async () => {
				await write("src/Analytics.mock.luau", "src/HttpMock.luau");

				expect(await variantsOf()).toEqual([
					[{ variant: "mock", form: "suffix" }],
					[],
				]);
			});

			it("should record a variant on a script's init file", async () => {
				await write("src/Combat/init.mock.luau");

				expect(await variantsOf()).toEqual([
					[{ variant: "mock", form: "suffix" }],
				]);
			});

			it("should record every variant a file carries", async () => {
				await write("src/dev/Save.mock.luau");

				expect(
					await variantsOf({ variants: { mock: true, dev: true } })
				).toEqual([
					[
						{ variant: "dev", form: "folder" },
						{ variant: "mock", form: "suffix" },
					],
				]);
			});

			it("should not record a dot-file or folder that is not a declared variant", async () => {
				await write("src/.beta", "src/beta/Save.luau");

				expect(await variantsOf()).toEqual([[]]);
			});

			it("should report a .server that a variant suffix follows", async () => {
				await write(
					"src/Foo.server.mock.luau",
					"src/Bar.mock.server.luau"
				);

				const files = (
					await route({ variants: { mock: true } })
				).unwrap().routed;

				expect(files.map((file) => file.buriedScriptSuffix)).toEqual([
					undefined,
					"server",
				]);
			});
		});

		describe("init folders", () => {
			it("should route the folder as one unit named after the folder", async () => {
				await write(
					"src/Inventory/Combat/init.luau",
					"src/Inventory/Combat/Helper.luau"
				);

				expect(await paths()).toEqual([
					"ReplicatedStorage/shared/Inventory/Combat",
				]);
			});

			it("should route an init folder through its routing ancestors", async () => {
				await write("src/server/Combat/init.luau");

				expect(await paths()).toEqual(["ServerScriptService/Combat"]);
			});

			it("should route an init folder by the suffix on its init script", async () => {
				await write("src/Combat/init.server.luau");

				expect(await paths()).toEqual(["ServerScriptService/Combat"]);
			});
		});

		describe("roots", () => {
			it("should route each root's files from its own root and keep root order", async () => {
				await write("core/server/A.luau", "lobby/server/B.luau");

				expect(await paths({}, [abs("core"), abs("lobby")])).toEqual([
					"ServerScriptService/A",
					"ServerScriptService/B",
				]);
			});

			it("should keep the scanned entry with its routed path", async () => {
				await write("src/server/A.luau");

				const [file] = (await route()).unwrap().routed;

				expect(file.entry).toEqual({
					kind: "script",
					rootDir: abs("src"),
					relativePath: "server/A.luau",
					source: abs("src/server/A.luau"),
				});
			});
		});

		describe("unrouted files", () => {
			const noStar = { routes: { server: "ServerScriptService" } };

			it("should leave files out when there is no * route", async () => {
				await write("src/server/A.luau", "src/B.luau");

				const result = (await route(noStar)).unwrap();

				expect(result.routed.map((file) => file.instancePath)).toEqual([
					["ServerScriptService", "A"],
				]);
			});

			it("should return the unrouted files' source paths", async () => {
				await write("src/server/A.luau", "src/B.luau");

				const result = (await route(noStar)).unwrap();

				expect(result.unrouted).toEqual([abs("src/B.luau")]);
			});

			it("should warn about each file no route governs, at that file", async () => {
				await write("src/A.luau", "src/Inventory/B.luau");

				const warnings = (await route(noStar))
					.unwrap()
					.warnings.filter(({ code }) => code === "route.unrouted");

				expect(warnings.map(({ resource }) => resource)).toEqual([
					abs("src/A.luau"),
					abs("src/Inventory/B.luau"),
				]);
				expect(warnings[0].message).toContain('"*"');
			});

			it("should list at most ten unrouted files, the last noting how many more weren't", async () => {
				await write(
					...Array.from(
						{ length: 12 },
						(_, n) => `src/F${n + 10}.luau`
					)
				);

				const warnings = (await route(noStar))
					.unwrap()
					.warnings.filter(({ code }) => code === "route.unrouted");

				expect(warnings).toHaveLength(10);
				expect(warnings[9].resource).toBe(abs("src/F19.luau"));
				expect(warnings[9].message).toContain(
					"2 more like it aren't listed"
				);
				expect(warnings[8].message).not.toContain("more like it");
			});

			it("should not warn when every file is routed", async () => {
				await write("src/server/A.luau");

				expect((await route(noStar)).unwrap().warnings).toEqual([]);
			});
		});
	});

	type VariantResult = Pick<Placement, "files" | "leftOut"> & {
		readonly warnings: readonly Diagnostic[];
	};

	const VARIANT_ROUTES = {
		server: "ServerScriptService",
		client: "StarterPlayer/StarterPlayerScripts",
		"*": "ReplicatedStorage",
	};

	describe("variants", () => {
		let fs: MemoryFileSystemService;
		let store: DisposableStore;

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		const apply = async (
			variants: Record<string, boolean>,
			rootDirs: readonly string[] = [abs("src")]
		) => {
			const config: ResolvedConfig = configOf({
				routes: VARIANT_ROUTES,
				variants,
				rootDirs: [...rootDirs],
			});
			const index = await indexOf(store, fs, rootDirs);
			const builder = builderOf(fs, index);
			const built = await builder.build(config);
			return built.map(({ warnings }): VariantResult => {
				const { files, leftOut } = builder.place(config).unwrap();
				return { files, leftOut, warnings };
			});
		};

		const prunedPaths = (result: VariantResult) =>
			[...result.leftOut]
				.filter(([, why]) => why.status === "pruned")
				.map(([source]) => source);

		const instances = async (
			variants: Record<string, boolean>,
			rootDirs?: readonly string[]
		) =>
			(await apply(variants, rootDirs))
				.unwrap()
				.files.map((file) => file.instancePath.join("/"));

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		describe("variant folder", () => {
			it("should move an active variant folder's contents up into the parent", async () => {
				await write("src/Analytics/mock/Service.luau");

				expect(await instances({ mock: true })).toEqual([
					"ReplicatedStorage/Analytics/Service",
				]);
			});

			it("should prune a dormant variant folder whole", async () => {
				await write(
					"src/Analytics/mock/Service.luau",
					"src/Analytics/mock/deep/Data.luau"
				);

				const result = (await apply({ mock: false })).unwrap();

				expect(result.files).toEqual([]);
				expect(prunedPaths(result)).toEqual([
					abs("src/Analytics/mock/Service.luau"),
					abs("src/Analytics/mock/deep/Data.luau"),
				]);
			});
		});

		describe("marker file", () => {
			it("should apply an active marker below and keep the folder's name", async () => {
				await write(
					"src/Experimental/.mock",
					"src/Experimental/Save.luau"
				);

				expect(await instances({ mock: true })).toEqual([
					"ReplicatedStorage/Experimental/Save",
				]);
			});

			it("should prune everything below a dormant marker", async () => {
				await write(
					"src/Experimental/.mock",
					"src/Experimental/Save.luau",
					"src/Experimental/deep/Load.luau",
					"src/Other.luau"
				);

				const result = (await apply({ mock: false })).unwrap();

				expect(result.files.map((file) => file.instancePath)).toEqual([
					["ReplicatedStorage", "Other"],
				]);
				expect(prunedPaths(result)).toEqual([
					abs("src/Experimental/Save.luau"),
					abs("src/Experimental/deep/Load.luau"),
				]);
			});
		});

		describe("suffix", () => {
			it("should strip an active suffix from the name", async () => {
				await write("src/Analytics.mock.luau");

				expect(await instances({ mock: true })).toEqual([
					"ReplicatedStorage/Analytics",
				]);
			});

			it("should prune a file with a dormant suffix silently when it uses a separator", async () => {
				await write("src/Analytics.mock.luau");

				const result = (await apply({ mock: false })).unwrap();

				expect(result.files).toEqual([]);
				expect(prunedPaths(result)).toEqual([
					abs("src/Analytics.mock.luau"),
				]);
				expect(result.warnings).toEqual([]);
			});

			it("should name the dormant variant that pruned each file, and how it matched", async () => {
				await write("src/Analytics.mock.luau", "src/dev/Save.luau");

				const result = (
					await apply({ mock: false, dev: false })
				).unwrap();

				expect(new Map(result.leftOut)).toEqual(
					new Map([
						[
							abs("src/Analytics.mock.luau"),
							{
								status: "pruned",
								variants: [{ variant: "mock", form: "suffix" }],
							},
						],
						[
							abs("src/dev/Save.luau"),
							{
								status: "pruned",
								variants: [{ variant: "dev", form: "folder" }],
							},
						],
					])
				);
			});

			it("should list every dormant variant a pruned file carries, the first first", async () => {
				await write("src/dev/Analytics.mock.luau");

				const result = (
					await apply({ mock: false, dev: false })
				).unwrap();

				expect(
					result.leftOut.get(abs("src/dev/Analytics.mock.luau"))
				).toEqual({
					status: "pruned",
					variants: [
						{ variant: "dev", form: "folder" },
						{ variant: "mock", form: "suffix" },
					],
				});
			});

			it("should report the file an active variant replaced", async () => {
				await write("src/Analytics.luau", "src/Analytics.mock.luau");

				const result = (await apply({ mock: true })).unwrap();

				expect(new Map(result.leftOut)).toEqual(
					new Map([
						[
							abs("src/Analytics.luau"),
							{
								status: "replaced",
								by: abs("src/Analytics.mock.luau"),
							},
						],
					])
				);
			});

			it("should name the file from the last root dir that replaced another", async () => {
				await write("core/Types.luau", "lobby/Types.luau");

				const result = (
					await apply({}, [abs("core"), abs("lobby")])
				).unwrap();

				expect(new Map(result.leftOut)).toEqual(
					new Map([
						[
							abs("core/Types.luau"),
							{ status: "replaced", by: abs("lobby/Types.luau") },
						],
					])
				);
			});

			it("should prune models by a dormant suffix too", async () => {
				await write("src/Gun.mock.rbxm");

				expect(
					prunedPaths((await apply({ mock: false })).unwrap())
				).toEqual([abs("src/Gun.mock.rbxm")]);
			});

			it("should prune a file carrying one dormant variant among active ones", async () => {
				await write("src/dev/Save.mock.luau");

				expect(await instances({ dev: true, mock: false })).toEqual([]);
			});
		});

		describe("capital suffix on a dormant variant", () => {
			it("should neither prune nor warn: a capital letter no longer carries a variant", async () => {
				await write("src/HttpMock.luau", "src/DataMock.luau");

				const result = (await apply({ mock: false })).unwrap();

				expect(result.files.map((file) => file.instancePath)).toEqual([
					["ReplicatedStorage", "DataMock"],
					["ReplicatedStorage", "HttpMock"],
				]);
				expect(prunedPaths(result)).toEqual([]);
				expect(result.warnings).toEqual([]);
			});
		});

		describe("precedence within a root dir", () => {
			it("should let dev/Service.luau beat prod/Service.luau when dev is active", async () => {
				await write("src/Analytics/dev/Service.luau");
				await write("src/Analytics/prod/Service.luau");

				const result = (
					await apply({ dev: true, prod: false })
				).unwrap();

				expect(
					result.files.map((file) => file.entry.relativePath)
				).toEqual(["Analytics/dev/Service.luau"]);
				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual(["ReplicatedStorage/Analytics/Service"]);
				expect(prunedPaths(result)).toEqual([
					abs("src/Analytics/prod/Service.luau"),
				]);
			});

			it("should let a variant file beat a plain one silently", async () => {
				await write("src/Analytics.luau", "src/Analytics.mock.luau");

				const result = (await apply({ mock: true })).unwrap();

				expect(
					result.files.map((file) => file.entry.relativePath)
				).toEqual(["Analytics.mock.luau"]);
				expect(result.warnings).toEqual([]);
			});

			it("should keep the plain file when the variant is dormant", async () => {
				await write("src/Analytics.luau", "src/Analytics.mock.luau");

				const result = (await apply({ mock: false })).unwrap();

				expect(
					result.files.map((file) => file.entry.relativePath)
				).toEqual(["Analytics.luau"]);
				expect(result.warnings).toEqual([]);
			});

			it("should fail at each file when two active variants claim one name", async () => {
				await write(
					"src/Analytics.mock.luau",
					"src/Analytics.dev.luau"
				);

				const result = await apply({ mock: true, dev: true });

				expect(
					result.isErr() ? result.error.diagnostics : []
				).toMatchObject([
					{
						severity: DiagnosticSeverity.Error,
						code: "variant.activeClash",
						resource: abs("src/Analytics.dev.luau"),
						message: `becomes "ReplicatedStorage/Analytics" with an active variant, and so does ${abs("src/Analytics.mock.luau")}. Only one can apply: turn a variant off or rename a file.`,
					},
					{
						code: "variant.activeClash",
						resource: abs("src/Analytics.mock.luau"),
					},
				]);
			});

			it("should fail when two files carry the same active variant", async () => {
				await write("src/mock/Service.luau", "src/Service.mock.luau");

				const result = await apply({ mock: true });

				expect(
					result.isErr() ? result.error.diagnostics[0].code : ""
				).toBe("variant.activeClash");
			});

			it("should warn at the plain file left out, naming the one used", async () => {
				await write("src/Types.luau", "src/Types.lua");

				const result = (await apply({})).unwrap();

				expect(
					result.files.map((file) => file.entry.relativePath)
				).toEqual(["Types.luau"]);
				expect(result.warnings).toEqual([
					{
						severity: DiagnosticSeverity.Warning,
						code: "tree.instanceClash",
						resource: abs("src/Types.lua"),
						message: `becomes "ReplicatedStorage/Types", as ${abs("src/Types.luau")} does, which takes its place. Rename one of them to keep both.`,
					},
				]);
			});

			it("should name the clash's winner in its own root dir when a later root dir wins", async () => {
				await write(
					"core/Types.luau",
					"core/Types.lua",
					"lobby/Types.luau"
				);

				const result = (
					await apply({}, [abs("core"), abs("lobby")])
				).unwrap();

				expect(result.warnings).toMatchObject([
					{
						resource: abs("core/Types.lua"),
						message: expect.stringContaining(
							`as ${abs("core/Types.luau")} does`
						),
					},
				]);
			});

			it("should warn at every plain file left out of a clash", async () => {
				await write(
					"src/Types.luau",
					"src/Types.lua",
					"src/Types.json"
				);

				const result = (await apply({})).unwrap();

				expect(result.warnings.map(({ resource }) => resource)).toEqual(
					[abs("src/Types.json"), abs("src/Types.lua")]
				);
			});

			it("should not warn about plain files that lose to a variant one", async () => {
				await write(
					"src/Types.luau",
					"src/Types.lua",
					"src/Types.mock.luau"
				);

				expect((await apply({ mock: true })).unwrap().warnings).toEqual(
					[]
				);
			});
		});

		describe("root dirs", () => {
			it("should let the last root dir win a clash without a warning", async () => {
				await write("core/Save.luau", "lobby/Save.luau");

				const result = (
					await apply({}, [abs("core"), abs("lobby")])
				).unwrap();

				expect(result.files.map((file) => file.entry.rootDir)).toEqual([
					abs("lobby"),
				]);
				expect(result.warnings).toEqual([]);
			});

			it("should apply the last-root rule after variant precedence", async () => {
				await write("core/Save.mock.luau", "lobby/Save.luau");

				const result = (
					await apply({ mock: true }, [abs("core"), abs("lobby")])
				).unwrap();

				expect(result.files.map((file) => file.entry.rootDir)).toEqual([
					abs("lobby"),
				]);
			});

			it("should not treat files in different root dirs as a variant clash", async () => {
				await write("core/Save.mock.luau", "lobby/Save.dev.luau");

				const result = await apply({ mock: true, dev: true }, [
					abs("core"),
					abs("lobby"),
				]);

				expect(result.isOk()).toBe(true);
			});
		});

		describe("warnings", () => {
			it("should warn that a script with a variant after .server becomes a ModuleScript", async () => {
				await write("src/Foo.server.mock.luau");

				const { warnings } = (await apply({ mock: true })).unwrap();

				expect(warnings).toMatchObject([
					{
						severity: DiagnosticSeverity.Warning,
						code: "variant.buriedScriptSuffix",
						resource: abs("src/Foo.server.mock.luau"),
					},
				]);
				expect(warnings[0].message).toContain(".server");
			});

			it("should not warn when the script suffix comes last", async () => {
				await write(
					"src/Foo.mock.server.luau",
					"src/Bar.mock.client.luau"
				);

				expect((await apply({ mock: true })).unwrap().warnings).toEqual(
					[]
				);
			});

			it("should not warn about a dormant file that is pruned anyway", async () => {
				await write("src/Foo.server.mock.luau");

				expect(
					(await apply({ mock: false })).unwrap().warnings
				).toEqual([]);
			});

			it("should keep a suffix that isn't a declared variant in the name, without a warning", async () => {
				await write("src/Foo.beta.luau");

				const result = (await apply({ mock: true })).unwrap();

				expect(
					result.files.map((file) => file.instancePath.join("/"))
				).toEqual(["ReplicatedStorage/Foo.beta"]);
				expect(result.warnings).toEqual([]);
			});
		});
	});
});
