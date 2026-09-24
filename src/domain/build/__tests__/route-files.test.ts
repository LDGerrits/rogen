import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { routeFiles } from "../route-files.js";
import { scanRootDirs } from "../root-scanner.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

const ROUTES = {
	ReplicatedFirst: "ReplicatedFirst",
	server: "ServerScriptService",
	client: "StarterPlayer/StarterPlayerScripts",
	"*": "ReplicatedStorage/shared",
};

describe("routeFiles", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const write = async (...paths: string[]) => {
		for (const p of paths) await fs.writeFile(abs(p), "");
	};

	const route = async (
		overrides: Partial<ResolvedConfig> = {},
		rootDirs: readonly string[] = [abs("src")]
	) => {
		const config = {
			routes: ROUTES,
			tags: {},
			outFile: abs("default.project.json"),
			...overrides,
		};
		const index = store.add(new CoreIndexService(fs));
		await index.initialize([...rootDirs]);
		const { roots } = scanRootDirs(index, { rootDirs, exclude: [] });
		return routeFiles(roots, config);
	};

	const paths = async (
		overrides: Partial<ResolvedConfig> = {},
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

		it("should strip the governing suffix in every separator and capital form", async () => {
			await write(
				"src/Inventory/Combat-server.luau",
				"src/Inventory/Save@server.luau",
				"src/Inventory/Load_Server.luau",
				"src/Inventory/PlayerServer.luau"
			);

			expect(await paths()).toEqual([
				"ServerScriptService/Inventory/Combat",
				"ServerScriptService/Inventory/Load",
				"ServerScriptService/Inventory/Player",
				"ServerScriptService/Inventory/Save",
			]);
		});

		it("should remove a routing folder and route below it", async () => {
			await write("src/Inventory/server/Save.luau");

			expect(await paths()).toEqual([
				"ServerScriptService/Inventory/Save",
			]);
		});

		it("should ignore a nested route folder's target but still remove the folder", async () => {
			await write("src/ReplicatedFirst/client/main.luau");

			expect(await paths()).toEqual(["ReplicatedFirst/main"]);
		});

		it("should ignore a suffix under an outer routing folder", async () => {
			await write("src/server/Inventory/Hud.client.luau");

			expect(await paths()).toEqual([
				"ServerScriptService/Inventory/Hud",
			]);
		});

		it("should ignore a suffix Rojo doesn't understand but leave it in the name", async () => {
			await write("src/server/Hud-client.luau");

			expect(await paths()).toEqual(["ServerScriptService/Hud-client"]);
		});

		it("should treat routing folders and markers case-sensitively", async () => {
			await write("src/Server/Save.luau");

			expect(await paths()).toEqual([
				"ReplicatedStorage/shared/Server/Save",
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

			expect(await paths()).toEqual(["ReplicatedStorage/shared/Save"]);
		});
	});

	describe("invisible folders", () => {
		it("should drop an invisible folder from the path", async () => {
			await write("src/Inventory/(internal)/Save.luau");

			expect(await paths()).toEqual([
				"ReplicatedStorage/shared/Inventory/Save",
			]);
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

		it("should fail with a diagnostic when a target's service is unsupported", async () => {
			await write("src/Types.luau");

			const result = await route({ routes: { "*": "Nowhere/shared" } });

			expect(result.isErr() ? result.error : []).toMatchObject([
				{
					severity: DiagnosticSeverity.Error,
					code: "roblox.unsupportedService",
					resource: abs("default.project.json"),
				},
			]);
		});
	});

	describe("suffixes and stacked keys", () => {
		it("should route a script whose route suffix is followed by a tag", async () => {
			await write("src/Foo.server.mock.luau");

			const result = await route({ tags: { mock: true } });

			expect(
				result.unwrap().routed.map((file) => file.instancePath)
			).toEqual([["ServerScriptService", "Foo"]]);
		});

		it("should strip a tag suffix from the name", async () => {
			await write("src/Foo.mock.server.luau");

			const result = await route({ tags: { mock: true } });

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

		it("should leave an ignored suffix on a model in its Rojo name", async () => {
			await write("src/server/Gun.client.rbxm");

			expect(await paths()).toEqual(["ServerScriptService/Gun.client"]);
		});

		it("should not route on a tag alone", async () => {
			await write("src/Foo.mock.luau");

			expect(await paths({ tags: { mock: true } })).toEqual([
				"ReplicatedStorage/shared/Foo",
			]);
		});

		it("should leave an undeclared suffix in the name", async () => {
			await write("src/Foo.beta.luau");

			expect(await paths({ tags: { mock: true } })).toEqual([
				"ReplicatedStorage/shared/Foo.beta",
			]);
		});
	});

	describe("tags", () => {
		const tagsOf = async (
			overrides: Partial<ResolvedConfig> = { tags: { mock: true } }
		) => (await route(overrides)).unwrap().routed.map((file) => file.tags);

		it("should remove a tag folder from the path", async () => {
			await write("src/Analytics/mock/Service.luau");

			const [file] = (await route({ tags: { mock: true } })).unwrap()
				.routed;

			expect(file.instancePath).toEqual([
				"ReplicatedStorage",
				"shared",
				"Analytics",
				"Service",
			]);
			expect(file.tags).toEqual([{ tag: "mock", form: "folder" }]);
		});

		it("should keep a folder that a tag marker applies to", async () => {
			await write("src/Experimental/.mock", "src/Experimental/Save.luau");

			const [file] = (await route({ tags: { mock: true } })).unwrap()
				.routed;

			expect(file.instancePath).toEqual([
				"ReplicatedStorage",
				"shared",
				"Experimental",
				"Save",
			]);
			expect(file.tags).toEqual([{ tag: "mock", form: "marker" }]);
		});

		it("should apply a marker in the root dir to every file", async () => {
			await write("src/.mock", "src/A/B.luau");

			expect(await tagsOf()).toEqual([[{ tag: "mock", form: "marker" }]]);
		});

		it("should record how a suffix matched", async () => {
			await write("src/Analytics.mock.luau", "src/HttpMock.luau");

			expect(await tagsOf()).toEqual([
				[{ tag: "mock", form: "separator" }],
				[{ tag: "mock", form: "capital" }],
			]);
		});

		it("should record a tag on a script's init file", async () => {
			await write("src/Combat/init.mock.luau");

			expect(await tagsOf()).toEqual([
				[{ tag: "mock", form: "separator" }],
			]);
		});

		it("should record every tag a file carries", async () => {
			await write("src/dev/Save.mock.luau");

			expect(await tagsOf({ tags: { mock: true, dev: true } })).toEqual([
				[
					{ tag: "dev", form: "folder" },
					{ tag: "mock", form: "separator" },
				],
			]);
		});

		it("should not record a dot-file or folder that is not a declared tag", async () => {
			await write("src/.beta", "src/beta/Save.luau");

			expect(await tagsOf()).toEqual([[]]);
		});

		it("should report a .server that a tag suffix follows", async () => {
			await write("src/Foo.server.mock.luau", "src/Bar.mock.server.luau");

			const files = (await route({ tags: { mock: true } })).unwrap()
				.routed;

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

		it("should report every unrouted file in one warning", async () => {
			await write("src/A.luau", "src/B.luau", "src/C.luau");

			const { warnings } = (await route(noStar)).unwrap();

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toMatchObject({
				severity: DiagnosticSeverity.Warning,
				code: "route.unrouted",
				resource: abs("default.project.json"),
			});
			expect(warnings[0].message).toContain("3 files");
			expect(warnings[0].message).toContain('"*"');
		});

		it("should list only the first few paths", async () => {
			await write(
				"src/A.luau",
				"src/B.luau",
				"src/C.luau",
				"src/D.luau",
				"src/E.luau"
			);

			const { warnings } = (await route(noStar)).unwrap();

			expect(warnings[0].message).toContain("5 files");
			expect(warnings[0].message).toContain("A.luau");
			expect(warnings[0].message).toContain("C.luau");
			expect(warnings[0].message).not.toContain("D.luau");
		});

		it("should not warn when every file is routed", async () => {
			await write("src/server/A.luau");

			expect((await route(noStar)).unwrap().warnings).toEqual([]);
		});

		it("should leave every file unrouted when routes is empty", async () => {
			await write("src/server/A.luau", "src/B.luau");

			const result = (await route({ routes: {} })).unwrap();

			expect(result.routed).toEqual([]);
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0].message).toContain("2 files");
		});

		it("should say file, not files, for one", async () => {
			await write("src/A.luau");

			const { warnings } = (await route(noStar)).unwrap();

			expect(warnings[0].message).toContain("1 file ");
		});
	});
});
