import { jest } from "@jest/globals";
import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { toPosix } from "../../../base/path.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { PlannedFilesIndex } from "../planned-files-index.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { ResolvedConfigSpec } from "../../config/__tests__/mock-config-service.js";
import {
	abs,
	buildServiceOf,
	configOf as baseConfigOf,
	indexOf,
	locateIn,
	writeFiles,
} from "./fixtures.js";

const configOf = (overrides: ResolvedConfigSpec = {}): ResolvedConfig =>
	baseConfigOf({
		routes: {
			Server: "ServerScriptService",
			Client: "StarterPlayer/StarterPlayerScripts",
			"*": "ReplicatedStorage/Shared",
		},
		...overrides,
	});

describe("CoreBuildService.locate", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const write = (...paths: string[]) => writeFiles(fs, ...paths);

	const buildService = () => buildServiceOf(fs, new CoreIndexService(fs));

	const locate = async (
		paths?: readonly string[],
		overrides: ResolvedConfigSpec = {}
	) => {
		const config = configOf(overrides);
		return (
			await locateIn(buildService(), config, {
				args:
					paths?.map((p) => abs(p) + (p.endsWith("/") ? "/" : "")) ??
					[],
				cwd: abs(),
			})
		).unwrap().files;
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

	describe("a named file", () => {
		beforeEach(() =>
			write("src/Util.luau", "src/Net/Http.luau", "src/Net/Socket.luau")
		);

		const namedSources = async (args: string[]) =>
			(await locate(args))
				.filter(
					(location) => location.status === "placed" && location.named
				)
				.map(({ source }) => source);

		it("should be marked as named", async () => {
			expect(await namedSources(["src/Util.luau"])).toEqual([
				abs("src/Util.luau"),
			]);
		});

		it("should mark a file that doesn't exist yet", async () => {
			expect(await namedSources(["src/New.luau"])).toEqual([
				abs("src/New.luau"),
			]);
		});

		it("should not mark the files found in a directory", async () => {
			expect(await namedSources(["src/Net"])).toEqual([]);
		});

		it("should keep the mark when the directory holding the file is named too", async () => {
			const expected = [abs("src/Net/Http.luau")];

			expect(
				await namedSources(["src/Net/Http.luau", "src/Net"])
			).toEqual(expected);
			expect(
				await namedSources(["src/Net", "src/Net/Http.luau"])
			).toEqual(expected);
		});

		it("should not mark the files behind an instance", async () => {
			const located = (
				await locateIn(buildService(), configOf(), {
					args: ["ReplicatedStorage.Shared.Util"],
					cwd: abs(),
				})
			).unwrap();

			expect(located.instances[0].files).toHaveLength(1);
			expect(located.instances[0].files[0].named).toBeUndefined();
		});
	});

	describe("a file with a position after it", () => {
		const save = "src/Inventory/Server/Save.luau";

		it.each([
			`${save}:12`,
			`${save}:12:5`,
			`${save}:12: attempt to index nil`,
			`${save}:12:5: attempt to index nil`,
			`${save}:12:5 - error: bad`,
			`${save}:`,
		])("should read %j as the file", async (arg) => {
			await write(save);

			expect(await locate([arg])).toMatchObject([
				{ status: "placed", source: abs(save) },
			]);
		});

		it("should read a position on a file that doesn't exist yet", async () => {
			await write("src/Other.luau");

			expect(await locate([`${save}:3`])).toMatchObject([
				{ status: "placed", source: abs(save), exists: false },
			]);
		});

		it("should keep a colon that isn't followed by a number", async () => {
			await write("src/Other.luau");

			expect(await locate(["src/Name:x.luau"])).toMatchObject([
				{ source: abs("src/Name:x.luau") },
			]);
		});

		it("should cut a Windows path at its position and not at its drive letter", async () => {
			const withDrive = await locate(["C:\\repo\\src\\Save.luau"]);
			const withLine = await locate(["C:\\repo\\src\\Save.luau:12"]);

			expect(withLine.map(({ source }) => source)).toEqual(
				withDrive.map(({ source }) => source)
			);
		});

		it("should keep a position on something that is neither there nor a file type", async () => {
			await write("src/Other.luau");

			expect(await locate(["src/Nope:12"])).toMatchObject([
				{ source: abs("src/Nope:12") },
			]);
		});
	});

	it("should place a file with its route and how the route matched", async () => {
		await write(
			"src/Inventory/Server/Save.luau",
			"src/Net/Http@client.luau",
			"src/Net/Socket.client.luau",
			"src/Anti/@server",
			"src/Anti/Check.luau",
			"src/Util.luau"
		);

		const located = await locate([
			"src/Inventory/Server/Save.luau",
			"src/Net/Http@client.luau",
			"src/Net/Socket.client.luau",
			"src/Anti/Check.luau",
			"src/Util.luau",
		]);

		expect(located).toEqual([
			{
				status: "placed",
				source: abs("src/Inventory/Server/Save.luau"),
				exists: true,
				instancePath: ["ServerScriptService", "Inventory", "Save"],
				route: "Server",
				routeMatch: "folder",
				variants: [],
				named: true,
			},
			{
				status: "placed",
				source: abs("src/Net/Http@client.luau"),
				exists: true,
				instancePath: [
					"StarterPlayer",
					"StarterPlayerScripts",
					"Net",
					"Http",
				],
				route: "Client",
				routeMatch: "suffix",
				variants: [],
				named: true,
			},
			expect.objectContaining({
				source: abs("src/Net/Socket.client.luau"),
				exists: true,
				routeMatch: "suffix",
			}),
			{
				status: "placed",
				source: abs("src/Anti/Check.luau"),
				exists: true,
				instancePath: ["ServerScriptService", "Anti", "Check"],
				route: "Server",
				routeMatch: "marker",
				variants: [],
				named: true,
			},
			{
				status: "placed",
				source: abs("src/Util.luau"),
				exists: true,
				instancePath: ["ReplicatedStorage", "Shared", "Util"],
				route: "*",
				routeMatch: "fallback",
				variants: [],
				named: true,
			},
		]);
	});

	it("should say which dormant variant pruned a file and how it matched, and which active variants a placed file carries", async () => {
		await write(
			"src/Net/Http.mock.luau",
			"src/Net/DataMock.luau",
			"src/Net/Store.dev.luau"
		);

		const located = await locate(undefined, {
			variants: { mock: false, dev: true },
		});

		expect(located).toEqual([
			expect.objectContaining({
				source: abs("src/Net/DataMock.luau"),
				exists: true,
				status: "placed",
			}),
			{
				status: "pruned",
				source: abs("src/Net/Http.mock.luau"),
				exists: true,
				variants: [{ variant: "mock", form: "suffix" }],
			},
			expect.objectContaining({
				source: abs("src/Net/Store.dev.luau"),
				exists: true,
				instancePath: ["ReplicatedStorage", "Shared", "Net", "Store"],
				variants: [{ variant: "dev", form: "suffix" }],
			}),
		]);
	});

	it("should say the template mounts a file inside a folder it mounts", async () => {
		await write("src/Vendor/Lib/Init.luau", "src/Save.luau");

		expect(
			await locate(["src/Vendor/Lib/Init.luau"], {
				template: {
					file: abs("template.project.json"),
					project: {
						name: "game",
						tree: {
							$className: "DataModel",
							ReplicatedStorage: {
								Vendor: { $path: "src/Vendor" },
							},
						},
					},
				},
			})
		).toEqual([
			{
				status: "mounted",
				source: abs("src/Vendor/Lib/Init.luau"),
				exists: true,
				node: ["ReplicatedStorage", "Vendor"],
			},
		]);
	});

	describe("a folder the template mounts outside the root dirs", () => {
		const template = {
			file: abs("template.project.json"),
			project: {
				name: "game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: {
						Packages: { $path: "Packages" },
						DevPackages: { $path: "DevPackages" },
					},
				},
			},
		};

		beforeEach(() => write("Packages/A.luau", "DevPackages/B.luau"));

		it("should be said to be mounted, with the files in it", async () => {
			expect(
				await locate(["Packages", "Packages/A.luau"], { template })
			).toMatchObject([
				{
					status: "mounted",
					source: abs("Packages"),
					node: ["ReplicatedStorage", "Packages"],
				},
				{
					status: "mounted",
					source: abs("Packages/A.luau"),
					node: ["ReplicatedStorage", "Packages"],
				},
			]);
		});

		it("should be said to be excluded when exclude drops its mount, as it does in a mode", async () => {
			expect(
				await locate(["DevPackages", "DevPackages/B.luau"], {
					template,
					exclude: [toPosix(abs("DevPackages"))],
				})
			).toMatchObject([
				{
					status: "excluded",
					source: abs("DevPackages"),
					pattern: toPosix(abs("DevPackages")),
				},
				{
					status: "excluded",
					source: abs("DevPackages/B.luau"),
					pattern: toPosix(abs("DevPackages")),
				},
			]);
		});
	});

	it("should name the file that replaced another at the same instance", async () => {
		await write("src/Types.lua", "src/Types.luau");

		expect(await locate(["src/Types.lua"])).toEqual([
			{
				status: "replaced",
				source: abs("src/Types.lua"),
				exists: true,
				by: abs("src/Types.luau"),
			},
		]);
	});

	it("should say the template displaced a file whose node it defines, or a folder under its $path", async () => {
		await write("src/Save.luau", "src/Packages/A.luau", "src/Kept.luau");
		const template = {
			file: abs("default.project.json"),
			project: {
				name: "repo",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: {
						Shared: {
							Save: { $path: "hand/Save.luau" },
							Packages: { $path: "Packages" },
						},
					},
				},
			},
		};

		expect(await locate(undefined, { template })).toEqual([
			{
				status: "placed",
				source: abs("src/Kept.luau"),
				exists: true,
				instancePath: ["ReplicatedStorage", "Shared", "Kept"],
				route: "*",
				routeMatch: "fallback",
				variants: [],
			},
			{
				status: "displaced",
				source: abs("src/Packages/A.luau"),
				exists: true,
				node: ["ReplicatedStorage", "Shared", "Packages"],
			},
			{
				status: "displaced",
				source: abs("src/Save.luau"),
				exists: true,
				node: ["ReplicatedStorage", "Shared", "Save"],
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
			{ status: "unrouted", source: abs("src/Util.luau"), exists: true },
			{
				status: "excluded",
				source: abs("src/Specs"),
				pattern: glob,
				exists: true,
			},
			{
				status: "excluded",
				source: abs("src/Specs/deep/B.luau"),
				exists: true,
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
			{ status: "empty", source: abs("src/Empty"), exists: true },
			{ status: "empty", source: abs("src/Docs"), exists: true },
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

		it("should say it doesn't exist, in a folder that does and in one that doesn't", async () => {
			await write("src/Combat/Server/Other.luau", "src/Here.luau");

			const located = await locate([
				"src/Combat/Server/Hit.luau",
				"src/Nope/Deep/X.luau",
				"src/Here.luau",
			]);

			expect(
				located.map(({ source, exists }) => [source, exists])
			).toEqual([
				[abs("src/Combat/Server/Hit.luau"), false],
				[abs("src/Nope/Deep/X.luau"), false],
				[abs("src/Here.luau"), true],
			]);
		});

		it("should mark a missing path named as a folder by a trailing separator only", async () => {
			await write("src/Other.luau");

			const located = [
				...(await locate(["src/Combat/"])),
				...(await locate(["src/Module"])),
				...(await locate(["src/Combat/Hit.luau"])),
			];

			expect(located).toMatchObject([
				{ status: "missing", folder: true },
				{ status: "missing" },
				{ status: "placed" },
			]);
			expect(located[1]).not.toHaveProperty("folder");
			expect(located[2]).not.toHaveProperty("folder");
		});

		it("should not mark an existing folder", async () => {
			await write("src/Combat/Hit.luau");

			expect(await locate(["src/Combat/"])).toMatchObject([
				{ status: "placed" },
			]);
		});

		it("should replace a file that does exist", async () => {
			await write("src/Analytics.luau");

			const located = await locate(
				["src/Analytics.luau", "src/Analytics.mock.luau"],
				{ variants: { mock: true } }
			);

			expect(located.map(({ status }) => status)).toEqual([
				"replaced",
				"placed",
			]);
		});

		it("should never be written to the listing it sits on", async () => {
			await write("src/Other.luau");
			const listing = await indexOf(store, fs, [abs("src")]);

			const planned = new PlannedFilesIndex(
				listing,
				[abs("src")],
				[abs("src/Combat/Server/Hit.luau")]
			);

			expect(planned.getEntries(abs("src/Combat"))).toBeDefined();
			expect(listing.getEntries(abs("src/Combat"))).toBeUndefined();
		});

		it("should sit beside the files that exist", async () => {
			await write("src/Other.luau");

			expect(
				await locate(["src/Combat/Server/Hit.luau", "src/Other.luau"])
			).toMatchObject([
				{
					status: "placed",
					instancePath: ["ServerScriptService", "Combat", "Hit"],
				},
				{
					status: "placed",
					instancePath: ["ReplicatedStorage", "Shared", "Other"],
				},
			]);
		});

		it("should only be planned when paths are named", async () => {
			await write("src/Other.luau");

			expect((await locate()).map(({ source }) => source)).toEqual([
				abs("src/Other.luau"),
			]);
		});

		it("should not be added when it isn't a source file", async () => {
			await write("src/Other.luau");

			expect(await locate(["src/Notes.md"])).toEqual([
				{
					status: "missing",
					source: abs("src/Notes.md"),
					exists: false,
				},
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
			{ status: "outside", source: abs("README.md"), exists: true },
			{
				status: "ignored",
				source: abs("src/Save.meta.json"),
				exists: true,
			},
			{
				status: "missing",
				source: abs("src/Nowhere"),
				exists: false,
			},
		]);
	});

	describe("an entry of unknown type", () => {
		const unknownEntry = async (name: string) => {
			await write("src/Other.luau", name);
			const readDirectory = fs.readDirectory.bind(fs);
			jest.spyOn(fs, "readDirectory").mockImplementation(async (dir) =>
				(await readDirectory(dir)).map(([entry, type]) => [
					entry,
					toPosix(path.join(dir, entry)) === toPosix(abs(name))
						? FileType.Unknown
						: type,
				])
			);
			return configOf();
		};

		it("should be reported as not an instance rather than missing", async () => {
			const config = await unknownEntry("src/Pipe.md");

			expect(
				(
					await locateIn(buildService(), config, {
						args: [abs("src/Pipe.md")],
						cwd: abs(),
					})
				).unwrap().files
			).toEqual([
				{ status: "ignored", source: abs("src/Pipe.md"), exists: true },
			]);
		});

		it("should not be replaced by a planned file", async () => {
			const config = await unknownEntry("src/Pipe.luau");
			const service = buildService();

			const named = await locateIn(service, config, {
				args: [abs("src/Pipe.luau")],
				cwd: abs(),
			});
			const all = await locateIn(service, config);

			expect(named.unwrap().files).toEqual(
				all
					.unwrap()
					.files.filter(
						({ source }) => source === abs("src/Pipe.luau")
					)
					.map((file) => ({ ...file, named: true }))
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
				exists: true,
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
					exists: true,
				},
			]);
		});

		it("should report a file excluded inside it as excluded, as the build leaves it out", async () => {
			await write(...files);
			const exclude = [abs("**/Punch.luau"), abs("**/Heavy")];

			const asked = await locate(
				[
					"src/Combat/Server/Moves/Punch.luau",
					"src/Combat/Server/Moves/Heavy/Slam.luau",
				],
				{ exclude }
			);
			const everything = await locate(undefined, { exclude });

			expect(asked).toEqual([
				{
					status: "excluded",
					pattern: abs("**/Punch.luau"),
					source: abs("src/Combat/Server/Moves/Punch.luau"),
					exists: true,
				},
				{
					status: "excluded",
					pattern: abs("**/Heavy"),
					source: abs("src/Combat/Server/Moves/Heavy/Slam.luau"),
					exists: true,
				},
			]);
			expect(instancePaths(everything)).toEqual([
				false,
				"ServerScriptService/Combat/Moves/Kick",
				false,
				"ServerScriptService/Combat/Moves",
			]);
		});

		it("should prune only its init script when that carries a dormant variant", async () => {
			await write(
				"src/Combat/Server/Moves/init.mock.luau",
				"src/Combat/Server/Moves/Punch.luau"
			);

			const located = await locate(["src/Combat/Server/Moves"], {
				variants: { mock: false },
			});

			expect(
				located.map(({ source, status }) => [
					path.basename(source),
					status,
				])
			).toEqual([
				["Punch.luau", "placed"],
				["init.mock.luau", "pruned"],
			]);
		});

		it("should list every node an init script is copied to, and find it at each", async () => {
			await write(
				"src/Net/init.luau",
				"src/Net/Types.luau",
				"src/Net/Server/Remote.luau",
				"src/Net/Client/Listener.luau"
			);
			const config = configOf();

			const located = (
				await locateIn(buildService(), config, {
					args: [abs("src/Net/init.luau"), "ServerScriptService.Net"],
					cwd: abs(),
				})
			).unwrap();

			expect(located.files).toEqual([
				{
					status: "placed",
					source: abs("src/Net/init.luau"),
					exists: true,
					instancePath: ["ReplicatedStorage", "Shared", "Net"],
					alsoAt: [
						["StarterPlayer", "StarterPlayerScripts", "Net"],
						["ServerScriptService", "Net"],
					],
					route: "*",
					routeMatch: "fallback",
					variants: [],
					named: true,
				},
			]);
			expect(
				located.instances[0].files.map(({ source }) => source)
			).toEqual([
				abs("src/Net/Server/Remote.luau"),
				abs("src/Net/init.luau"),
			]);
		});
	});

	describe("where an instance no file places would go", () => {
		const foldersFor = async (...references: string[]) =>
			foldersIn(configOf(), ...references);

		const foldersIn = async (
			config: ResolvedConfig,
			...references: string[]
		) => {
			const located = (
				await locateIn(buildService(), config, {
					args: references,
					cwd: abs(),
				})
			).unwrap();
			return located.instances.map(({ folders }) => folders);
		};

		it("should name the folder of the files placed beside it", async () => {
			await write(
				"src/Inventory/Server/Save.luau",
				"src/Inventory/Server/Load.luau",
				"src/Inventory/Types.luau"
			);

			expect(
				await foldersFor("ServerScriptService.Inventory.NewThing")
			).toEqual([[abs("src/Inventory/Server")]]);
		});

		it("should name every folder that supplies the parent, sorted", async () => {
			await write(
				"src/Inventory/Server/Save.luau",
				"extra/Inventory/Server/Load.luau"
			);

			expect(
				await foldersIn(
					configOf({ rootDirs: [abs("src"), abs("extra")] }),
					"ServerScriptService.Inventory.NewThing"
				)
			).toEqual([
				[abs("extra/Inventory/Server"), abs("src/Inventory/Server")],
			]);
		});

		it("should count the init script that places the parent", async () => {
			await write("src/Net/Server/Moves/init.luau");

			expect(
				await foldersFor("ServerScriptService.Net.Moves.Kick")
			).toEqual([[abs("src/Net/Server/Moves")]]);
		});

		it("should name the folder beside a folder's init script for its sibling", async () => {
			await write("src/Net/Server/Moves/init.luau");

			expect(
				await foldersFor("ServerScriptService.Net.NewThing")
			).toEqual([[abs("src/Net/Server")]]);
		});

		it("should count an init script whose name carries a route as the folder it is", async () => {
			await write("src/Net/Moves/init@Server.luau");

			expect(
				await foldersFor("ServerScriptService.Net.NewThing")
			).toEqual([[abs("src/Net")]]);
		});

		it("should count an init script whose name carries a variant as the folder it is", async () => {
			await write("src/Net/Server/Moves/init.mock.luau");

			expect(
				await foldersIn(
					configOf({
						variants: { mock: true },
						rootDirs: [abs("src")],
					}),
					"ServerScriptService.Net.NewThing"
				)
			).toEqual([[abs("src/Net/Server")]]);
		});

		it("should go up to the nearest parent something is placed in", async () => {
			await write("src/Inventory/Server/Save.luau");

			expect(
				await foldersFor("ServerScriptService.Inventory.Deep.NewThing")
			).toEqual([[abs("src/Inventory/Server")]]);
		});

		it("should name nothing for a service or an instance in an empty parent", async () => {
			await write("src/Inventory/Server/Save.luau");

			expect(await foldersFor("Workspace", "Workspace.Map.Tree")).toEqual(
				[[], []]
			);
		});

		it("should name the folder for the first file on a new side of a feature", async () => {
			await write("src/Shop/Types.luau");

			expect(await foldersFor("ServerScriptService.Shop.Buy")).toEqual([
				[abs("src/Shop/Server")],
			]);
		});

		it("should name the root dir's routing folder for a feature that doesn't exist yet", async () => {
			await write("src/Other/Types.luau");

			expect(
				await foldersFor("ServerScriptService.Shop.Cart.Buy")
			).toEqual([[abs("src/Shop/Cart/Server")]]);
		});

		it("should go only as deep as the folders that exist", async () => {
			await write("src/Shop/Types.luau");

			expect(
				await foldersFor("ServerScriptService.Shop.Cart.Buy")
			).toEqual([[abs("src/Shop/Cart/Server")]]);
		});

		it("should name a route's folder for an instance directly in its target", async () => {
			await write("src/Other/Types.luau");

			expect(await foldersFor("ServerScriptService.Boot")).toEqual([
				[abs("src/Server")],
			]);
		});

		it("should drop a candidate that a governing route sends elsewhere", async () => {
			await write("src/Shop/@Client", "src/Shop/Types.luau");

			expect(await foldersFor("ServerScriptService.Shop.Buy")).toEqual([
				[],
			]);
		});

		it("should name nothing when no route leads the instance", async () => {
			await write("src/Shop/Types.luau");

			expect(await foldersFor("Workspace.Shop.Buy")).toEqual([[]]);
		});

		it("should name the rename of a file a stray @ left out of place", async () => {
			await write("src/Shop/Buy@sever.luau");

			const [instance] = (
				await locateIn(buildService(), configOf(), {
					args: ["ServerScriptService.Shop.Buy"],
					cwd: abs(),
				})
			).unwrap().instances;

			expect(instance.fixes).toEqual([
				{
					code: "route.strayAt",
					rename: {
						from: abs("src/Shop/Buy@sever.luau"),
						to: abs("src/Shop/Buy@Server.luau"),
					},
				},
			]);
			expect(instance.folders).toEqual([]);
		});

		it("should not offer a rename that places a different instance", async () => {
			await write("src/Shop/Cart@sever.luau");

			const [instance] = (
				await locateIn(buildService(), configOf(), {
					args: ["ServerScriptService.Shop.Buy"],
					cwd: abs(),
				})
			).unwrap().instances;

			expect(instance.fixes).toEqual([]);
		});

		it("should name nothing when files place the instance", async () => {
			await write("src/Inventory/Server/Save.luau");

			expect(
				await foldersFor("ServerScriptService.Inventory.Save")
			).toEqual([[]]);
		});
	});

	it("should index the root dirs it reads itself", async () => {
		await write("src/A.luau");

		const located = await locateIn(
			buildServiceOf(fs, new CoreIndexService(fs)),
			configOf()
		);

		expect(located.unwrap().files).toMatchObject([
			{ status: "placed", source: abs("src/A.luau"), exists: true },
		]);
	});
});
