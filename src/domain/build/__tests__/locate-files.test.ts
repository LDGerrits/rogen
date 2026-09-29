import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { locateFiles } from "../build.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

const configOf = (overrides: Partial<ResolvedConfig> = {}): ResolvedConfig => ({
	file: abs("default.rogen.json"),
	name: "repo",
	rootDirs: [abs("src")],
	routes: {
		Server: "ServerScriptService",
		Client: "StarterPlayer/StarterPlayerScripts",
		"*": "ReplicatedStorage/Shared",
	},
	tags: {},
	exclude: [],
	outFile: abs("default.project.json"),
	...overrides,
});

describe("locateFiles", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const write = async (...paths: string[]) => {
		for (const p of paths) await fs.writeFile(abs(p), "");
	};

	const locate = async (
		paths?: readonly string[],
		overrides: Partial<ResolvedConfig> = {}
	) => {
		const config = configOf(overrides);
		const index = store.add(new CoreIndexService(fs));
		await index.initialize(config.rootDirs);
		return locateFiles(
			index,
			config,
			paths?.map((p) => abs(p))
		).unwrap();
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should place a file with its route and how the route matched", async () => {
		await write(
			"src/Inventory/Server/Save.luau",
			"src/Net/HttpClient.luau",
			"src/Anti/.server",
			"src/Anti/Check.luau",
			"src/Util.luau"
		);

		const located = await locate([
			"src/Inventory/Server/Save.luau",
			"src/Net/HttpClient.luau",
			"src/Anti/Check.luau",
			"src/Util.luau",
		]);

		expect(located).toEqual([
			{
				status: "placed",
				source: abs("src/Inventory/Server/Save.luau"),
				instancePath: ["ServerScriptService", "Inventory", "Save"],
				route: "Server",
				routeMatch: "folder",
				tags: [],
			},
			{
				status: "placed",
				source: abs("src/Net/HttpClient.luau"),
				instancePath: [
					"StarterPlayer",
					"StarterPlayerScripts",
					"Net",
					"Http",
				],
				route: "Client",
				routeMatch: "suffix",
				tags: [],
			},
			{
				status: "placed",
				source: abs("src/Anti/Check.luau"),
				instancePath: ["ServerScriptService", "Anti", "Check"],
				route: "Server",
				routeMatch: "marker",
				tags: [],
			},
			{
				status: "placed",
				source: abs("src/Util.luau"),
				instancePath: ["ReplicatedStorage", "Shared", "Util"],
				route: "*",
				routeMatch: "fallback",
				tags: [],
			},
		]);
	});

	it("should say which dormant tag pruned a file, and which active tags a placed file carries", async () => {
		await write("src/Net/Http.mock.luau", "src/Net/Store.dev.luau");

		const located = await locate(undefined, {
			tags: { mock: false, dev: true },
		});

		expect(located).toEqual([
			{
				status: "pruned",
				source: abs("src/Net/Http.mock.luau"),
				tag: "mock",
			},
			expect.objectContaining({
				source: abs("src/Net/Store.dev.luau"),
				instancePath: ["ReplicatedStorage", "Shared", "Net", "Store"],
				tags: ["dev"],
			}),
		]);
	});

	it("should name the file that replaced another at the same instance", async () => {
		await write("src/Types.lua", "src/Types.luau");

		expect(await locate(["src/Types.lua"])).toEqual([
			{
				status: "replaced",
				source: abs("src/Types.lua"),
				by: abs("src/Types.luau"),
			},
		]);
	});

	it("should report unrouted and excluded files, and files inside an excluded folder", async () => {
		await write("src/Util.luau", "src/Specs/A.spec.luau");

		const located = await locate(
			["src/Util.luau", "src/Specs/A.spec.luau"],
			{
				routes: { Server: "ServerScriptService" },
				exclude: [`${abs("src/Specs")}`],
			}
		);

		expect(located).toEqual([
			{ status: "unrouted", source: abs("src/Util.luau") },
			{ status: "excluded", source: abs("src/Specs/A.spec.luau") },
		]);
	});

	it("should stand a directory for every path below it, sorted", async () => {
		await write(
			"src/Inventory/Server/Save.luau",
			"src/Inventory/Client/Hud.luau",
			"src/Other.luau"
		);

		const located = await locate(["src/Inventory"]);

		expect(located.map(({ source }) => source)).toEqual([
			abs("src/Inventory/Client/Hud.luau"),
			abs("src/Inventory/Server/Save.luau"),
		]);
	});

	it("should locate every scanned path when given none", async () => {
		await write("src/B.luau", "src/A/Server/C.luau");

		const located = await locate();

		expect(located.map(({ source }) => source)).toEqual([
			abs("src/A/Server/C.luau"),
			abs("src/B.luau"),
		]);
	});

	it("should place a file that doesn't exist yet, in folders that don't either, as if it did", async () => {
		await write("src/Other.luau");

		const located = await locate(["src/Combat/Server/Hit.luau"]);

		expect(located).toEqual([
			expect.objectContaining({
				status: "placed",
				instancePath: ["ServerScriptService", "Combat", "Hit"],
			}),
		]);
		expect(await fs.exists(abs("src/Combat"))).toBe(false);
	});

	it("should let a file that doesn't exist yet replace one that does", async () => {
		await write("src/Analytics.luau");

		const located = await locate(
			["src/Analytics.luau", "src/Analytics.mock.luau"],
			{
				tags: { mock: true },
			}
		);

		expect(located.map(({ status }) => status)).toEqual([
			"replaced",
			"placed",
		]);
	});

	it("should report a path outside the root dirs, one that isn't an instance, and one that doesn't exist", async () => {
		await write("src/Save.meta.json", "src/Save.luau", "README.md");

		const located = await locate([
			"README.md",
			"src/Save.meta.json",
			"src/Nowhere",
		]);

		expect(located).toEqual([
			{ status: "outside", source: abs("README.md") },
			{ status: "ignored", source: abs("src/Save.meta.json") },
			{ status: "missing", source: abs("src/Nowhere") },
		]);
	});

	it("should place a file inside an init folder below the folder's instance", async () => {
		await write(
			"src/Combat/Server/Moves/init.luau",
			"src/Combat/Server/Moves/Punch.luau"
		);

		const located = await locate([
			"src/Combat/Server/Moves/init.luau",
			"src/Combat/Server/Moves/Punch.luau",
		]);

		expect(
			located.map(
				(location) =>
					"instancePath" in location && location.instancePath
			)
		).toEqual([
			["ServerScriptService", "Combat", "Moves"],
			["ServerScriptService", "Combat", "Moves", "Punch"],
		]);
	});

	it("should fail with the build's errors", async () => {
		await write("src/A.luau");
		const config = configOf({ routes: {} });
		const index = store.add(new CoreIndexService(fs));
		await index.initialize(config.rootDirs);

		const result = locateFiles(index, config);

		expect(result.isErr() && result.error.map(({ code }) => code)).toEqual([
			"route.noRoutes",
		]);
	});
});
