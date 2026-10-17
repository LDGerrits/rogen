import { jest } from "@jest/globals";
import path from "path";
import { toPosix } from "../../../base/path.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { ConfigBuilder } from "../config-builder.js";
import { PlannedFilesIndex } from "../locate/planned-files-index.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { RojoFile } from "../../rojo/rojo.js";
import {
	ResolvedConfigSpec,
	selectionOf,
} from "../../config/__tests__/mock-config-service.js";
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
				"instancePath" in location && location.instancePath?.join("/")
		);

	beforeEach(() => {
		fs = new MemoryFileSystemService();
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
			expect(located.instances[0].files[0]).not.toHaveProperty("named");
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
				named: true,
				luau: "module",
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
				named: true,
				luau: "module",
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
				named: true,
				luau: "module",
			},
			{
				status: "placed",
				source: abs("src/Util.luau"),
				exists: true,
				instancePath: ["ReplicatedStorage", "Shared", "Util"],
				route: "*",
				routeMatch: "fallback",
				named: true,
				luau: "module",
			},
		]);
	});

	it("should say the tree mounts a file inside a folder it mounts", async () => {
		await write("src/Vendor/Lib/Init.luau", "src/Save.luau");

		expect(
			await locate(["src/Vendor/Lib/Init.luau"], {
				project: {
					name: "game",
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Vendor: { $path: "src/Vendor" },
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
				instancePath: ["ReplicatedStorage", "Vendor", "Lib", "Init"],
			},
		]);
	});

	describe("what a mount makes of the files in it", () => {
		const project = {
			name: "game",
			tree: {
				$className: "DataModel",
				ReplicatedStorage: { Packages: { $path: "Packages" } },
				ServerScriptService: { Server: { $path: "server" } },
			},
		};
		const instanceOf = async (file: string) => {
			const [location] = await locate([file], { project });
			return location.status === "mounted"
				? location.instancePath?.join("/")
				: location.status;
		};

		beforeEach(() =>
			write(
				"Packages/A.luau",
				"Packages/Sub/B.server.luau",
				"Packages/A.meta.json",
				"Packages/README.md",
				"Packages/Group/init.luau",
				"Packages/Group/C.luau",
				"server/init.server.luau",
				"server/Main.luau",
				"server/Data.model.json",
				"server/Info.txt"
			)
		);

		it("should name the instance a file becomes, as Rojo reads it", async () => {
			expect(await instanceOf("Packages/A.luau")).toBe(
				"ReplicatedStorage/Packages/A"
			);
			expect(await instanceOf("Packages/Sub/B.server.luau")).toBe(
				"ReplicatedStorage/Packages/Sub/B"
			);
			expect(await instanceOf("server/Data.model.json")).toBe(
				"ServerScriptService/Server/Data"
			);
			expect(await instanceOf("server/Info.txt")).toBe(
				"ServerScriptService/Server/Info"
			);
		});

		it("should make an init file the instance of its folder", async () => {
			expect(await instanceOf("server/init.server.luau")).toBe(
				"ServerScriptService/Server"
			);
			expect(await instanceOf("Packages/Group/init.luau")).toBe(
				"ReplicatedStorage/Packages/Group"
			);
			expect(await instanceOf("Packages/Group/C.luau")).toBe(
				"ReplicatedStorage/Packages/Group/C"
			);
		});

		it("should name the instance a meta file changes, and none for a file Rojo reads nothing from", async () => {
			expect(await instanceOf("Packages/A.meta.json")).toBe(
				"ReplicatedStorage/Packages/A"
			);
			expect(await instanceOf("Packages/README.md")).toBeUndefined();
		});

		it("should list the mounts inside a folder that holds some", async () => {
			expect(
				await locate(["."], {
					project: {
						name: "game",
						tree: {
							$className: "DataModel",
							ReplicatedStorage: {
								One: { $path: "a/one" },
								Two: { $path: "a/two" },
							},
						},
					},
				})
			).toMatchObject([
				{
					status: "mounted",
					source: abs("a/one"),
					instancePath: ["ReplicatedStorage", "One"],
				},
				{
					status: "mounted",
					source: abs("a/two"),
					instancePath: ["ReplicatedStorage", "Two"],
				},
			]);
		});

		describe("asked by instance", () => {
			const filesFor = async (instance: string) => {
				const located = (
					await locateIn(buildService(), configOf({ project }), {
						args: [instance],
						cwd: abs(),
					})
				).unwrap();
				return located.instances[0].files.map(({ source }) => source);
			};

			it("should find the file of a mounted instance", async () => {
				expect(await filesFor("ReplicatedStorage.Packages.A")).toEqual([
					abs("Packages/A.luau"),
				]);
				expect(
					await filesFor("ReplicatedStorage.Packages.Sub.B")
				).toEqual([abs("Packages/Sub/B.server.luau")]);
			});

			it("should find the init file of a mounted folder", async () => {
				expect(await filesFor("ServerScriptService.Server")).toEqual([
					abs("server/init.server.luau"),
				]);
				expect(
					await filesFor("ReplicatedStorage.Packages.Group")
				).toEqual([abs("Packages/Group/init.luau")]);
				expect(
					await filesFor("ReplicatedStorage.Packages.Group.C")
				).toEqual([abs("Packages/Group/C.luau")]);
			});

			it("should find nothing for an instance no mounted file makes", async () => {
				expect(
					await filesFor("ReplicatedStorage.Packages.Nope")
				).toEqual([]);
				expect(
					await filesFor("ReplicatedStorage.Packages.A.Inside")
				).toEqual([]);
			});
		});
	});

	describe("a folder the tree mounts outside the source paths", () => {
		const project = {
			name: "game",
			tree: {
				$className: "DataModel",
				ReplicatedStorage: {
					Packages: { $path: "Packages" },
					DevPackages: { $path: "DevPackages" },
				},
			},
		};

		beforeEach(() => write("Packages/A.luau", "DevPackages/B.luau"));

		it("should be said to be mounted, with the files in it", async () => {
			expect(
				await locate(["Packages", "Packages/A.luau"], { project })
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

		it("should be said to be mounted even when a glob in ignored matches the mount itself", async () => {
			expect(
				await locate(["DevPackages", "DevPackages/B.luau"], {
					project,
					ignored: [toPosix(abs("DevPackages"))],
				})
			).toMatchObject([
				{
					status: "mounted",
					source: abs("DevPackages"),
					node: ["ReplicatedStorage", "DevPackages"],
				},
				{
					status: "mounted",
					source: abs("DevPackages/B.luau"),
					node: ["ReplicatedStorage", "DevPackages"],
				},
			]);
		});

		it("should be said to be ignored for a file in the mount that a glob matches", async () => {
			const pattern = `${toPosix(abs("DevPackages"))}/**`;

			expect(
				await locate(["DevPackages", "DevPackages/B.luau"], {
					project,
					ignored: [pattern],
				})
			).toMatchObject([
				{
					status: "mounted",
					source: abs("DevPackages"),
					node: ["ReplicatedStorage", "DevPackages"],
				},
				{
					status: "ignored",
					source: abs("DevPackages/B.luau"),
					pattern,
				},
			]);
		});
	});

	it("should say a path outside the source paths is ignored when a glob matches it and no mount is there", async () => {
		await write("DevPackages/B.luau");
		const pattern = `${toPosix(abs("DevPackages"))}/**`;

		expect(
			await locate(["DevPackages", "DevPackages/B.luau"], {
				ignored: [pattern],
			})
		).toMatchObject([
			{ status: "ignored", source: abs("DevPackages"), pattern },
			{ status: "ignored", source: abs("DevPackages/B.luau"), pattern },
		]);
	});

	it("should say a file beside a default.project.json is in that nested project", async () => {
		await write("src/Nest/default.project.json", "src/Nest/code.luau");

		expect(await locate(["src/Nest/code.luau"])).toMatchObject([
			{
				status: "inProject",
				source: abs("src/Nest/code.luau"),
				project: toPosix(abs("src/Nest/default.project.json")),
			},
		]);
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

	it.each([
		["init.luau", "init.server.luau"],
		["init.luau", "init.client.luau"],
		["init.client.luau", "init.csv"],
	])(
		"should say %s replaces %s as the folder's init file, as Rojo reads it",
		async (winner, loser) => {
			await write(`src/Net/${winner}`, `src/Net/${loser}`);

			expect(await locate([`src/Net/${loser}`])).toMatchObject([
				{ status: "replaced", by: abs(`src/Net/${winner}`) },
			]);
		}
	);

	it("should rank the init files among the files of one name, wherever a plain file sits", async () => {
		await write(
			"src/Net.luau",
			"src/Net/init.luau",
			"src/Net/init.server.luau"
		);

		expect(await locate(["src/Net/init.server.luau"])).toMatchObject([
			{ status: "replaced", by: abs("src/Net/init.luau") },
		]);
	});

	it("should say the tree displaced a file whose node it defines, or a folder under its $path", async () => {
		await write("src/Save.luau", "src/Packages/A.luau", "src/Kept.luau");
		const project = {
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
		};

		expect(await locate(undefined, { project })).toEqual([
			{
				status: "placed",
				source: abs("src/Kept.luau"),
				exists: true,
				instancePath: ["ReplicatedStorage", "Shared", "Kept"],
				route: "*",
				routeMatch: "fallback",
				luau: "module",
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

	it("should report an unrouted file, and an ignored file or folder with the glob that ignored it", async () => {
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
				ignored: [glob],
			}
		);

		expect(located).toEqual([
			{ status: "unrouted", source: abs("src/Util.luau"), exists: true },
			{
				status: "ignored",
				source: abs("src/Specs"),
				pattern: glob,
				exists: true,
			},
			{
				status: "ignored",
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

	it("should list everything below a directory that holds the source paths", async () => {
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
			await write("src/Analytics.lua");

			const located = await locate([
				"src/Analytics.lua",
				"src/Analytics.luau",
			]);

			expect(located.map(({ status }) => status)).toEqual([
				"replaced",
				"placed",
			]);
		});

		it("should never be written to the listing it sits on", async () => {
			await write("src/Other.luau");
			const listing = await indexOf(fs, [abs("src")]);

			const planned = new PlannedFilesIndex(
				listing,
				[abs("src")],
				[abs("src/Combat/Server/Hit.luau")],
				(source) => RojoFile.at(source, configOf().syncRules)
			);

			expect(planned.getEntries(abs("src/Combat"))).toBeDefined();
			expect(listing.getEntries(abs("src/Combat"))).toBeUndefined();
		});

		it("should add nothing for files that exist, or that are no source file", async () => {
			await write("src/Other.luau");
			const listing = await indexOf(fs, [abs("src")]);
			const planned = (...paths: string[]) =>
				new PlannedFilesIndex(
					listing,
					[abs("src")],
					paths.map((p) => abs(p)),
					(source) => RojoFile.at(source, configOf().syncRules)
				);

			expect(planned("src/Other.luau").addsNothing).toBe(true);
			expect(planned("src/Notes.md").addsNothing).toBe(true);
			expect(planned("elsewhere/A.luau").addsNothing).toBe(true);
			expect(planned("src/New.luau").addsNothing).toBe(false);
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

	it("should report a path outside the source paths, one that isn't an instance, and one that doesn't exist", async () => {
		await write("src/Save.meta.json", "src/Save.luau", "README.md");

		const located = await locate([
			"README.md",
			"src/Save.meta.json",
			"src/Nowhere",
		]);

		expect(located).toEqual([
			{ status: "outside", source: abs("README.md"), exists: true },
			{
				status: "notInstance",
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
				{
					status: "notInstance",
					source: abs("src/Pipe.md"),
					exists: true,
				},
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
					status: "notInstance",
					source: abs("src/Combat/Server/Moves/Notes.md"),
					exists: true,
				},
			]);
		});

		it("should report a file ignored inside it as ignored, as the build leaves it out", async () => {
			await write(...files);
			const ignored = [abs("**/Punch.luau"), abs("**/Heavy")];

			const asked = await locate(
				[
					"src/Combat/Server/Moves/Punch.luau",
					"src/Combat/Server/Moves/Heavy/Slam.luau",
				],
				{ ignored }
			);
			const everything = await locate(undefined, { ignored });

			expect(asked).toEqual([
				{
					status: "ignored",
					pattern: abs("**/Punch.luau"),
					source: abs("src/Combat/Server/Moves/Punch.luau"),
					exists: true,
				},
				{
					status: "ignored",
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

		it("should find only the script a line number names, and a folder with what is in it", async () => {
			await write(
				"src/Net/init.luau",
				"src/Net/Types.luau",
				"src/Net/Remote.luau"
			);
			const config = configOf();
			const files = async (instance: string) =>
				(
					await locateIn(buildService(), config, {
						args: [instance],
						cwd: abs(),
					})
				)
					.unwrap()
					.instances[0].files.map(({ source }) => source);

			expect(await files("ReplicatedStorage.Shared.Net:3: oops")).toEqual(
				[abs("src/Net/init.luau")]
			);
			expect(await files("ReplicatedStorage.Shared.Net")).toEqual([
				abs("src/Net/Remote.luau"),
				abs("src/Net/Types.luau"),
				abs("src/Net/init.luau"),
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
					named: true,
					luau: "module",
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
					configOf({ sourcePaths: [abs("src"), abs("extra")] }),
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

		it("should name the source path's routing folder for a feature that doesn't exist yet", async () => {
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

	describe("staleness", () => {
		const staleOf = async (
			paths: readonly string[] = [],
			configs: readonly ResolvedConfig[] = [configOf()],
			index = new CoreIndexService(fs)
		) =>
			(
				await buildServiceOf(fs, index).locate(
					selectionOf(...configs),
					{
						args: paths.map((p) => abs(p)),
						cwd: abs(),
						staleness: true,
					}
				)
			).unwrap().stale;

		it("should report a project file that differs from what a build would write", async () => {
			await write("src/A.luau");
			await fs.writeFile(abs("default.project.json"), "{}");

			expect(await staleOf()).toMatchObject([
				{
					code: "output.differs",
					resource: abs("default.project.json"),
				},
			]);
		});

		it("should report it for a path that is asked about, as for none", async () => {
			await write("src/A.luau");
			await fs.writeFile(abs("default.project.json"), "{}");

			expect(await staleOf(["src/A.luau"])).toHaveLength(1);
			expect(await staleOf(["src/New.luau"])).toHaveLength(1);
		});

		it("should not report a project file a build would write as it is", async () => {
			await write("src/A.luau");
			const index = new CoreIndexService(fs);
			await buildServiceOf(fs, index).build(selectionOf(configOf()));

			expect(await staleOf(["src/A.luau"])).toEqual([]);
			expect(await staleOf(["src/New.luau"])).toEqual([]);
		});

		it("should report nothing for a project file that isn't on disk", async () => {
			await write("src/A.luau");

			expect(await staleOf()).toEqual([]);
		});

		it("should report nothing when it is not asked for", async () => {
			await write("src/A.luau");
			await fs.writeFile(abs("default.project.json"), "{}");

			const located = await buildService().locate(
				selectionOf(configOf()),
				{ args: [], cwd: abs() }
			);

			expect(located.unwrap().stale).toEqual([]);
		});

		it("should say the same as staleProjectFiles, for the projects it does not read too", async () => {
			await write("src/A.luau");
			const release = configOf({ stem: "release" });
			await fs.writeFile(abs("default.project.json"), "{}");
			await fs.writeFile(abs("release.project.json"), "{}");
			const selection = selectionOf(configOf(), release);

			const stale = await staleOf([], [configOf(), release]);

			expect(stale).toEqual(
				await buildService().staleProjectFiles(selection)
			);
			expect(stale).toHaveLength(2);
		});

		it("should list the folders once", async () => {
			await write("src/A.luau");
			await fs.writeFile(abs("default.project.json"), "{}");
			const index = new CoreIndexService(fs);
			const list = jest.spyOn(index, "list");

			await staleOf(["src/A.luau"], [configOf()], index);

			expect(list).toHaveBeenCalledTimes(1);
		});

		it("should build no more than the locate did when a read config's file is stale", async () => {
			await write("src/A.luau");
			await fs.writeFile(abs("default.project.json"), "{}");
			const rebuilt = jest.spyOn(
				ConfigBuilder.prototype,
				"projectFileOf"
			);

			await staleOf(["src/A.luau"]);

			expect(rebuilt).not.toHaveBeenCalled();
			rebuilt.mockRestore();
		});

		it("should not build a project it doesn't read when its file isn't on disk", async () => {
			await write("src/A.luau");
			const rebuilt = jest.spyOn(
				ConfigBuilder.prototype,
				"projectFileOf"
			);

			expect(
				await staleOf([], [configOf(), configOf({ stem: "release" })])
			).toEqual([]);

			expect(rebuilt).not.toHaveBeenCalled();
			rebuilt.mockRestore();
		});

		it("should build a project it doesn't read once its file is on disk", async () => {
			await write("src/A.luau");
			await fs.writeFile(abs("release.project.json"), "{}");
			const rebuilt = jest.spyOn(
				ConfigBuilder.prototype,
				"projectFileOf"
			);

			expect(
				await staleOf([], [configOf(), configOf({ stem: "release" })])
			).toHaveLength(1);

			expect(rebuilt).toHaveBeenCalledTimes(1);
			rebuilt.mockRestore();
		});

		it("should examine each config once when no path is planned", async () => {
			await write("src/A.luau");
			await fs.writeFile(abs("default.project.json"), "{}");
			const read = jest.spyOn(fs, "readDirectory");

			await staleOf(["src/A.luau"]);
			const once = read.mock.calls.length;
			read.mockClear();
			await buildService().locate(selectionOf(configOf()), {
				args: [abs("src/A.luau")],
				cwd: abs(),
			});

			expect(once).toBe(read.mock.calls.length);
		});
	});

	it("should index the source paths it reads itself", async () => {
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
