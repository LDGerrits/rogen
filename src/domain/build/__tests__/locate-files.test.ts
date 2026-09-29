import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { FileChangeType } from "../../../platform/fs/file-events.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { locateFiles, withPlannedFiles } from "../build.js";

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

	const indexOf = async (config: ResolvedConfig) => {
		const index = store.add(new CoreIndexService(fs));
		await index.initialize(config.rootDirs);
		return index;
	};

	const locate = async (
		paths?: readonly string[],
		overrides: Partial<ResolvedConfig> = {}
	) => {
		const config = configOf(overrides);
		const index = await indexOf(config);
		const absolute = paths?.map((p) => abs(p));
		const planned = absolute
			? withPlannedFiles(index, config.rootDirs, absolute)
			: index;
		return locateFiles(planned, config, absolute).unwrap();
	};

	const instancePaths = (located: Awaited<ReturnType<typeof locate>>) =>
		located.map(
			(location) =>
				"instancePath" in location && location.instancePath.join("/")
		);

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
			"src/Net/Socket-Client.luau",
			"src/Anti/.server",
			"src/Anti/Check.luau",
			"src/Util.luau"
		);

		const located = await locate([
			"src/Inventory/Server/Save.luau",
			"src/Net/HttpClient.luau",
			"src/Net/Socket-Client.luau",
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
				routeMatch: "capital",
				tags: [],
			},
			expect.objectContaining({
				source: abs("src/Net/Socket-Client.luau"),
				routeMatch: "separator",
			}),
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

	it("should say which dormant tag pruned a file and how it matched, and which active tags a placed file carries", async () => {
		await write(
			"src/Net/Http.mock.luau",
			"src/Net/DataMock.luau",
			"src/Net/Store.dev.luau"
		);

		const located = await locate(undefined, {
			tags: { mock: false, dev: true },
		});

		expect(located).toEqual([
			{
				status: "pruned",
				source: abs("src/Net/DataMock.luau"),
				tags: [
					{
						tag: "mock",
						form: "capital",
						separatorName: "Data.mock.luau",
					},
				],
			},
			{
				status: "pruned",
				source: abs("src/Net/Http.mock.luau"),
				tags: [{ tag: "mock", form: "separator" }],
			},
			expect.objectContaining({
				source: abs("src/Net/Store.dev.luau"),
				instancePath: ["ReplicatedStorage", "Shared", "Net", "Store"],
				tags: [{ tag: "dev", form: "separator" }],
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

	it("should report an unrouted file, and an excluded file or folder with the glob that excluded it", async () => {
		await write(
			"src/Util.luau",
			"src/Specs/A.spec.luau",
			"src/Specs/deep/B.luau"
		);
		const glob = abs("src/Specs");

		const located = await locate(
			["src/Util.luau", "src/Specs", "src/Specs/deep/B.luau"],
			{
				routes: { Server: "ServerScriptService" },
				exclude: [glob],
			}
		);

		expect(located).toEqual([
			{ status: "unrouted", source: abs("src/Util.luau") },
			{ status: "excluded", source: abs("src/Specs"), pattern: glob },
			{
				status: "excluded",
				source: abs("src/Specs/deep/B.luau"),
				pattern: glob,
			},
		]);
	});

	it("should stand a directory for every file below it, sorted, and never list the directory itself", async () => {
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

	it("should list everything below a directory that holds the root dirs", async () => {
		await write("src/A.luau");

		const located = await locate(["."]);

		expect(located.map(({ source }) => source)).toEqual([
			abs("src/A.luau"),
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

	it("should say a directory is empty when nothing in it places", async () => {
		await write("src/Docs/notes.md");
		await fs.createDirectory(abs("src/Empty"));

		expect(await locate(["src/Empty", "src/Docs"])).toEqual([
			{ status: "empty", source: abs("src/Empty") },
			{ status: "empty", source: abs("src/Docs") },
		]);
	});

	describe("a file that doesn't exist yet", () => {
		it("should be placed as if it did, with folders that don't exist either", async () => {
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

		it("should replace a file that does exist", async () => {
			await write("src/Analytics.luau");

			const located = await locate(
				["src/Analytics.luau", "src/Analytics.mock.luau"],
				{ tags: { mock: true } }
			);

			expect(located.map(({ status }) => status)).toEqual([
				"replaced",
				"placed",
			]);
		});

		it("should never be written to the index it is layered over", async () => {
			await write("src/Other.luau");
			const config = configOf();
			const index = await indexOf(config);
			const updates: unknown[] = [];
			index.onDidUpdate((changes) => updates.push(changes));

			const planned = withPlannedFiles(index, config.rootDirs, [
				abs("src/Combat/Server/Hit.luau"),
			]);

			expect(planned.hasEntry(abs("src/Combat/Server"), "Hit.luau")).toBe(
				true
			);
			expect([...(planned.getEntries(abs("src/Combat")) ?? [])]).toEqual([
				["Server", FileType.Directory],
			]);
			expect(planned.getEntries(abs("src"))?.has("Other.luau")).toBe(
				true
			);
			expect(index.getEntries(abs("src/Combat"))).toBeUndefined();
			expect(updates).toEqual([]);
		});

		it("should not be added by locating alone", async () => {
			await write("src/Other.luau");
			const config = configOf();
			const index = await indexOf(config);

			const located = locateFiles(index, config, [
				abs("src/Combat/Server/Hit.luau"),
			]).unwrap();

			expect(located).toEqual([
				{
					status: "missing",
					source: abs("src/Combat/Server/Hit.luau"),
				},
			]);
			expect(index.getEntries(abs("src/Combat"))).toBeUndefined();
		});

		it("should not be added when it isn't a source file", async () => {
			await write("src/Other.luau");

			expect(await locate(["src/Notes.md"])).toEqual([
				{ status: "missing", source: abs("src/Notes.md") },
			]);
		});
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

	describe("an entry of unknown type", () => {
		const unknownEntry = async (name: string) => {
			await write("src/Other.luau");
			const config = configOf();
			const index = await indexOf(config);
			index.applyChanges([
				{
					type: FileChangeType.ADDED,
					path: abs(name),
					fileType: FileType.Unknown,
				},
			]);
			return { config, index };
		};

		it("should be reported as not an instance rather than missing", async () => {
			const { config, index } = await unknownEntry("src/Pipe.md");

			expect(
				locateFiles(index, config, [abs("src/Pipe.md")]).unwrap()
			).toEqual([{ status: "ignored", source: abs("src/Pipe.md") }]);
		});

		it("should not be replaced by a planned file", async () => {
			const { config, index } = await unknownEntry("src/Pipe.luau");

			const planned = withPlannedFiles(index, config.rootDirs, [
				abs("src/Pipe.luau"),
			]);

			expect(planned.getEntryType(abs("src"), "Pipe.luau")).toBe(
				FileType.Unknown
			);
		});
	});

	describe("an init folder", () => {
		const files = [
			"src/Combat/Server/Moves/init.luau",
			"src/Combat/Server/Moves/Punch.luau",
			"src/Combat/Server/Moves/Kick.server.luau",
			"src/Combat/Server/Moves/Heavy/Slam.luau",
			"src/Combat/Server/Moves/Notes.md",
		];

		it("should list its init script as the folder and every other script below it, in the whole tree and in a query for the folder", async () => {
			await write(...files);

			const everything = await locate();
			const asked = await locate(["src/Combat/Server/Moves"]);

			expect(instancePaths(everything)).toEqual([
				"ServerScriptService/Combat/Moves/Heavy/Slam",
				"ServerScriptService/Combat/Moves/Kick",
				"ServerScriptService/Combat/Moves/Punch",
				"ServerScriptService/Combat/Moves",
			]);
			expect(asked).toEqual(everything);
			expect(everything[3]).toMatchObject({
				source: abs("src/Combat/Server/Moves/init.luau"),
				route: "Server",
				routeMatch: "folder",
			});
		});

		it("should place a file added below it as a child of the folder", async () => {
			await write(...files);

			const located = await locate([
				"src/Combat/Server/Moves/Sweep.luau",
			]);

			expect(instancePaths(located)).toEqual([
				"ServerScriptService/Combat/Moves/Sweep",
			]);
		});

		it("should say a file below it that Rojo doesn't read isn't an instance", async () => {
			await write(...files);

			expect(await locate(["src/Combat/Server/Moves/Notes.md"])).toEqual([
				{
					status: "ignored",
					source: abs("src/Combat/Server/Moves/Notes.md"),
				},
			]);
		});

		it("should share the fate of the folder when a dormant tag prunes it", async () => {
			await write(
				"src/Combat/Server/Moves/init.mock.luau",
				"src/Combat/Server/Moves/Punch.luau"
			);

			const located = await locate(
				[
					"src/Combat/Server/Moves",
					"src/Combat/Server/Moves/Punch.luau",
				],
				{ tags: { mock: false } }
			);

			expect(located.map(({ status }) => status)).toEqual([
				"pruned",
				"pruned",
			]);
		});
	});

	it("should fail with the build's errors", async () => {
		await write("src/A.luau");
		const config = configOf({ routes: {} });
		const index = await indexOf(config);

		const result = locateFiles(index, config);

		expect(result.isErr() && result.error.map(({ code }) => code)).toEqual([
			"route.noRoutes",
		]);
	});
});
