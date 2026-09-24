import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { applyTags } from "../apply-tags.js";
import { scanRootDirs } from "../root-scanner.js";
import { routeFiles } from "../route-files.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

const ROUTES = {
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	"*": "ReplicatedStorage",
};

describe("applyTags", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const write = async (...paths: string[]) => {
		for (const p of paths) await fs.writeFile(abs(p), "");
	};

	const apply = async (
		tags: Record<string, boolean>,
		rootDirs: readonly string[] = [abs("src")]
	) => {
		const config: Pick<ResolvedConfig, "routes" | "tags" | "outFile"> = {
			routes: ROUTES,
			tags,
			outFile: abs("default.project.json"),
		};
		const index = store.add(new CoreIndexService(fs));
		await index.initialize([...rootDirs]);
		const { roots } = scanRootDirs(index, { rootDirs, exclude: [] });
		return applyTags(routeFiles(roots, config).unwrap().routed, config);
	};

	const instances = async (
		tags: Record<string, boolean>,
		rootDirs?: readonly string[]
	) =>
		(await apply(tags, rootDirs))
			.unwrap()
			.files.map((file) => file.instancePath.join("/"));

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("tag folder", () => {
		it("should move an active tag folder's contents up into the parent", async () => {
			await write("src/Analytics/mock/Service.luau");

			expect(await instances({ mock: true })).toEqual([
				"ReplicatedStorage/Analytics/Service",
			]);
		});

		it("should prune a dormant tag folder whole", async () => {
			await write(
				"src/Analytics/mock/Service.luau",
				"src/Analytics/mock/deep/Data.luau"
			);

			const result = (await apply({ mock: false })).unwrap();

			expect(result.files).toEqual([]);
			expect(result.pruned).toEqual([
				abs("src/Analytics/mock/Service.luau"),
				abs("src/Analytics/mock/deep/Data.luau"),
			]);
		});
	});

	describe("marker file", () => {
		it("should apply an active marker below and keep the folder's name", async () => {
			await write("src/Experimental/.mock", "src/Experimental/Save.luau");

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
			expect(result.pruned).toEqual([
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
			expect(result.pruned).toEqual([abs("src/Analytics.mock.luau")]);
			expect(result.warnings).toEqual([]);
		});

		it("should prune models by a dormant suffix too", async () => {
			await write("src/Gun.mock.rbxm");

			expect((await apply({ mock: false })).unwrap().pruned).toEqual([
				abs("src/Gun.mock.rbxm"),
			]);
		});

		it("should prune a file carrying one dormant tag among active ones", async () => {
			await write("src/dev/Save.mock.luau");

			expect(await instances({ dev: true, mock: false })).toEqual([]);
		});
	});

	describe("capital suffix on a dormant tag", () => {
		it("should prune the files and warn once, naming every path", async () => {
			await write(
				"src/HttpMock.luau",
				"src/DataMock.luau",
				"src/Analytics.mock.luau"
			);

			const result = (await apply({ mock: false })).unwrap();

			expect(result.files).toEqual([]);
			expect(result.pruned).toHaveLength(3);
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toMatchObject({
				severity: DiagnosticSeverity.Warning,
				code: "tag.dormantCapitalSuffix",
				resource: abs("default.project.json"),
			});
			expect(result.warnings[0].message).toContain("2 files");
			expect(result.warnings[0].message).toContain(
				abs("src/HttpMock.luau")
			);
			expect(result.warnings[0].message).toContain(
				abs("src/DataMock.luau")
			);
			expect(result.warnings[0].message).not.toContain("Analytics");
		});

		it("should warn once per tag", async () => {
			await write("src/HttpMock.luau", "src/UnitTest.luau");

			const { warnings } = (
				await apply({ mock: false, test: false })
			).unwrap();

			expect(warnings.map((warning) => warning.code)).toEqual([
				"tag.dormantCapitalSuffix",
				"tag.dormantCapitalSuffix",
			]);
		});

		it("should not warn or prune when the tag is active", async () => {
			await write("src/HttpMock.luau");

			const result = (await apply({ mock: true })).unwrap();

			expect(result.warnings).toEqual([]);
			expect(result.files.map((file) => file.instancePath)).toEqual([
				["ReplicatedStorage", "Http"],
			]);
		});
	});

	describe("precedence within a root dir", () => {
		it("should let dev/Service.luau beat prod/Service.luau when dev is active", async () => {
			await write("src/Analytics/dev/Service.luau");
			await write("src/Analytics/prod/Service.luau");

			const result = (await apply({ dev: true, prod: false })).unwrap();

			expect(result.files.map((file) => file.entry.relativePath)).toEqual(
				["Analytics/dev/Service.luau"]
			);
			expect(
				result.files.map((file) => file.instancePath.join("/"))
			).toEqual(["ReplicatedStorage/Analytics/Service"]);
			expect(result.pruned).toEqual([
				abs("src/Analytics/prod/Service.luau"),
			]);
		});

		it("should let a tagged file beat an untagged one silently", async () => {
			await write("src/Analytics.luau", "src/Analytics.mock.luau");

			const result = (await apply({ mock: true })).unwrap();

			expect(result.files.map((file) => file.entry.relativePath)).toEqual(
				["Analytics.mock.luau"]
			);
			expect(result.warnings).toEqual([]);
		});

		it("should keep the untagged file when the variant is dormant", async () => {
			await write("src/Analytics.luau", "src/Analytics.mock.luau");

			const result = (await apply({ mock: false })).unwrap();

			expect(result.files.map((file) => file.entry.relativePath)).toEqual(
				["Analytics.luau"]
			);
			expect(result.warnings).toEqual([]);
		});

		it("should fail naming both files when two active tags claim one name", async () => {
			await write("src/Analytics.mock.luau", "src/Analytics.dev.luau");

			const result = await apply({ mock: true, dev: true });

			expect(result.isErr() ? result.error : []).toMatchObject([
				{
					severity: DiagnosticSeverity.Error,
					code: "tag.activeClash",
					resource: abs("default.project.json"),
				},
			]);
			const message = result.isErr() ? result.error[0].message : "";
			expect(message).toContain(abs("src/Analytics.dev.luau"));
			expect(message).toContain(abs("src/Analytics.mock.luau"));
		});

		it("should fail when two files carry the same active tag", async () => {
			await write("src/mock/Service.luau", "src/Service.mock.luau");

			const result = await apply({ mock: true });

			expect(result.isErr() ? result.error[0].code : "").toBe(
				"tag.activeClash"
			);
		});

		it("should warn about two untagged files and use the last", async () => {
			await write("src/Types.luau", "src/Types.lua");

			const result = (await apply({})).unwrap();

			expect(result.files.map((file) => file.entry.relativePath)).toEqual(
				["Types.luau"]
			);
			expect(result.warnings).toMatchObject([
				{
					severity: DiagnosticSeverity.Warning,
					code: "tag.untaggedClash",
				},
			]);
			expect(result.warnings[0].message).toContain(abs("src/Types.lua"));
			expect(result.warnings[0].message).toContain(abs("src/Types.luau"));
		});

		it("should not warn about untagged files that lose to a tagged one", async () => {
			await write(
				"src/Types.luau",
				"src/Types.lua",
				"src/Types.mock.luau"
			);

			expect((await apply({ mock: true })).unwrap().warnings).toEqual([]);
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

		it("should apply the last-root rule after tag precedence", async () => {
			await write("core/Save.mock.luau", "lobby/Save.luau");

			const result = (
				await apply({ mock: true }, [abs("core"), abs("lobby")])
			).unwrap();

			expect(result.files.map((file) => file.entry.rootDir)).toEqual([
				abs("lobby"),
			]);
		});

		it("should not treat files in different root dirs as a tag clash", async () => {
			await write("core/Save.mock.luau", "lobby/Save.dev.luau");

			const result = await apply({ mock: true, dev: true }, [
				abs("core"),
				abs("lobby"),
			]);

			expect(result.isOk()).toBe(true);
		});
	});

	describe("warnings", () => {
		it("should warn that a script with a tag after .server becomes a ModuleScript", async () => {
			await write("src/Foo.server.mock.luau");

			const { warnings } = (await apply({ mock: true })).unwrap();

			expect(warnings).toMatchObject([
				{
					severity: DiagnosticSeverity.Warning,
					code: "tag.buriedScriptSuffix",
					resource: abs("src/Foo.server.mock.luau"),
				},
			]);
			expect(warnings[0].message).toContain(".server");
		});

		it("should not warn when the script suffix comes last", async () => {
			await write("src/Foo.mock.server.luau", "src/Bar.mock.client.luau");

			expect((await apply({ mock: true })).unwrap().warnings).toEqual([]);
		});

		it("should not warn about a dormant file that is pruned anyway", async () => {
			await write("src/Foo.server.mock.luau");

			expect((await apply({ mock: false })).unwrap().warnings).toEqual(
				[]
			);
		});

		it("should keep a suffix that isn't a declared tag in the name, without a warning", async () => {
			await write("src/Foo.beta.luau");

			const result = (await apply({ mock: true })).unwrap();

			expect(
				result.files.map((file) => file.instancePath.join("/"))
			).toEqual(["ReplicatedStorage/Foo.beta"]);
			expect(result.warnings).toEqual([]);
		});
	});
});
