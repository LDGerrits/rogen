import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { build, rootsToIndex } from "../build.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

const configOf = (overrides: Partial<ResolvedConfig> = {}): ResolvedConfig => ({
	name: "repo",
	rootDirs: [abs("src")],
	routes: { "*": "ReplicatedStorage" },
	tags: {},
	exclude: [],
	outFile: abs("default.project.json"),
	...overrides,
});

describe("domain/build/build", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const indexOf = async (rootDirs: readonly string[]) => {
		const index = store.add(new CoreIndexService(fs));
		await index.initialize([...rootDirs]);
		return index;
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("build", () => {
		it("should return a tree with no warnings when every root dir exists", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const config = configOf();

			const result = build(config, await indexOf(config.rootDirs));

			expect(result.unwrap().warnings).toEqual([]);
			expect(result.unwrap().value.tree).toEqual({
				$className: "DataModel",
			});
		});

		it("should warn about a missing root dir and still succeed", async () => {
			await fs.writeFile(abs("core/A.luau"), "");
			const config = configOf({ rootDirs: [abs("core"), abs("lobby")] });

			const result = build(config, await indexOf(config.rootDirs));

			expect(result.unwrap().warnings).toMatchObject([
				{
					severity: DiagnosticSeverity.Warning,
					code: "scan.missingRootDir",
					resource: abs("lobby"),
				},
			]);
		});

		it("should report unrouted files as one warning after the scan's", async () => {
			await fs.writeFile(abs("core/A.luau"), "");
			const config = configOf({
				rootDirs: [abs("core"), abs("lobby")],
				routes: {},
			});

			const result = build(config, await indexOf(config.rootDirs));

			expect(
				result.unwrap().warnings.map((warning) => warning.code)
			).toEqual(["scan.missingRootDir", "route.unrouted"]);
		});

		it("should fail when a route targets an unsupported service", async () => {
			await fs.writeFile(abs("src/A.luau"), "");
			const config = configOf({ routes: { "*": "Nowhere" } });

			const result = build(config, await indexOf(config.rootDirs));

			expect(result.isErr() ? result.error : []).toMatchObject([
				{ code: "roblox.unsupportedService" },
			]);
		});

		it("should name the project after the config's resolved name", async () => {
			await fs.createDirectory(abs("src"));
			const config = configOf({ name: "lobby" });

			const result = build(config, await indexOf(config.rootDirs));

			expect(result.unwrap().value.name).toBe("lobby");
		});
	});

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
});
