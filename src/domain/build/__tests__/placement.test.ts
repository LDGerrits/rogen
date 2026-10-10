import { DisposableStore } from "../../../base/disposable.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import { abs, buildAndPlace, configOf, writeFiles } from "./fixtures.js";

describe("Placement", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const placementOf = async (overrides: ResolvedConfigSpec = {}) =>
		(
			await buildAndPlace(
				store,
				fs,
				configOf({
					routes: { "*": "ReplicatedStorage" },
					...overrides,
				})
			)
		).unwrap().placement;

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("metaFiles", () => {
		it("should list every meta file of every root dir, with its path in the root dir", async () => {
			await writeFiles(fs, "src/Net/A.luau", "lib/B.luau");
			await fs.writeFile(abs("src/Net/init.meta.json"), "{}");
			await fs.writeFile(abs("lib/B.meta.json"), "{}");

			const placement = await placementOf({
				rootDirs: [abs("src"), abs("lib")],
			});

			expect(placement.metaFiles).toEqual([
				{
					rootDir: abs("src"),
					relativePath: "Net/init.meta.json",
					file: abs("src/Net/init.meta.json"),
				},
				{
					rootDir: abs("lib"),
					relativePath: "B.meta.json",
					file: abs("lib/B.meta.json"),
				},
			]);
		});
	});

	describe("readingOf", () => {
		it("should read a placed file by its name", async () => {
			await writeFiles(fs, "src/Boot.server.luau");

			const placement = await placementOf();
			const [file] = placement.files;

			expect(placement.readingOf(file)).toMatchObject({
				kind: "script",
				scriptSuffix: "server",
			});
		});
	});
});
