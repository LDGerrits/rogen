import { jest } from "@jest/globals";
import { toPosix } from "../../../base/path.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { FileChangeType } from "../../../platform/fs/file-changes.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { ScannedRoot } from "../root-scanner.js";
import {
	abs,
	builderOf,
	configOf,
	placeFiles,
	syncTools,
	writeFiles,
} from "./fixtures.js";

describe("RootScanner", () => {
	type ScanOptions = Pick<ResolvedConfig, "rootDirs" | "exclude">;

	const scanRootDirs = (index: IndexReader, options: ScanOptions) =>
		placeFiles(index, configOf(options), syncTools).unwrap();

	const glob = (pattern: string) => toPosix(abs(pattern));

	describe("scan", () => {
		let fs: MemoryFileSystemService;

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
				warnings: built.isOk()
					? built.value.findings.warnings
					: built.error,
			};
		};

		const files = (root: ScannedRoot) =>
			root.entries.map((entry) => `${entry.kind}:${entry.relativePath}`);

		const write = (...paths: string[]) => writeFiles(fs, ...paths);

		beforeEach(() => {
			fs = new MemoryFileSystemService();
		});

		describe("the project file it writes", () => {
			it("should be left out when a root dir holds it", async () => {
				await write("src/A.luau", "src/game.project.json");
				const index = await newIndex().list([abs("src")]);
				const config = configOf({
					rootDirs: [abs("src")],
					exclude: [],
					outFile: abs("src/game.project.json"),
				});

				const [root] = builderOf(fs, index)
					.place(config)
					.unwrap().roots;

				expect(files(root)).toEqual(["script:A.luau"]);
				expect(
					root.leftOut.get(toPosix(abs("src/game.project.json")))
				).toEqual({
					status: "excluded",
					pattern: "game.project.json",
				});
			});
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

			it("should record every meta inside a folder with an init script", async () => {
				await write(
					"src/Bots/init.luau",
					"src/Bots/init.meta.json",
					"src/Bots/Brain.luau",
					"src/Bots/Brain.meta.json"
				);

				const { roots } = await scan();

				expect(roots[0].metaFiles).toEqual([
					"Bots/Brain.meta.json",
					"Bots/init.meta.json",
				]);
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

			it("should leave out a file whose extension is not in lowercase, as Rojo does, and name the file Rojo reads", async () => {
				await write("src/A.LUAU", "src/B.Rbxm", "src/C.MODEL.JSON");

				const { roots } = await scan();

				expect(files(roots[0])).toEqual([]);
				expect(
					[...roots[0].leftOut].map(([file, why]) => [
						file,
						why.status === "extensionCase" && why.rename,
					])
				).toEqual([
					[abs("src/A.LUAU"), "A.luau"],
					[abs("src/B.Rbxm"), "B.rbxm"],
					[abs("src/C.MODEL.JSON"), "C.model.json"],
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
			it("should list an init script and what sits beside it as files of their own", async () => {
				await write(
					"src/Inventory/init.luau",
					"src/Inventory/Helper.luau"
				);

				const { roots } = await scan();

				expect(roots[0].entries).toEqual([
					{
						kind: "script",
						rootDir: abs("src"),
						relativePath: "Inventory/Helper.luau",
						source: abs("src/Inventory/Helper.luau"),
					},
					{
						kind: "script",
						rootDir: abs("src"),
						relativePath: "Inventory/init.luau",
						source: abs("src/Inventory/init.luau"),
					},
				]);
			});

			it("should walk beneath a folder with an init script", async () => {
				await write(
					"src/Inventory/init.luau",
					"src/Inventory/deep/Nested.luau",
					"src/Inventory/deep/.server"
				);

				const { roots } = await scan();

				expect(files(roots[0])).toEqual([
					"script:Inventory/deep/Nested.luau",
					"script:Inventory/init.luau",
				]);
				expect(roots[0].markers).toEqual(["Inventory/deep/.server"]);
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
			it("should leave a Rogen config out, as it is no game data", async () => {
				await write(
					"src/Keep.luau",
					"src/Inventory/default.rogen.json",
					"src/Inventory/lobby.rogen.json"
				);

				const { roots } = await scan();

				expect(files(roots[0])).toEqual(["script:Keep.luau"]);
				expect(
					roots[0].leftOut.get(
						toPosix(abs("src/Inventory/default.rogen.json"))
					)
				).toEqual({
					status: "excluded",
					pattern: "*.rogen.json",
				});
			});

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

			it("should scan a linked directory with an init script through the link", async () => {
				await write("shared/Pkg/init.luau");
				await fs.createSymbolicLink(abs("shared/Pkg"), abs("src/Pkg"));

				const { roots } = await scan();

				expect(roots[0].entries).toEqual([
					{
						kind: "script",
						rootDir: abs("src"),
						relativePath: "Pkg/init.luau",
						source: abs("src/Pkg/init.luau"),
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
});
