import { jest } from "@jest/globals";
import path from "path";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import {
	abs,
	writeServiceOf,
	configOf,
	writeFiles,
} from "../../write/__tests__/fixtures.js";
import {
	MockConfigService,
	selectionOf,
} from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { CoreSyncbackService } from "../core-syncback-service.js";
import { MirrorPlanner } from "../mirror-planner.js";
import { MirrorWorkspace } from "../mirror-workspace.js";
import { SyncbackLayout } from "../syncback-layout.js";
import { SyncbackMirror } from "../syncback-mirror.js";
import { MIRROR } from "../syncback-staging.js";
import { RojoFile } from "../../rojo/rojo.js";
import { SyncRules } from "../../rojo/sync-rules.js";
import { PlacedLocation, WriteService } from "../../write/write-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { toPosix } from "../../../base/path.js";
import { SyncbackMode, SyncbackResult } from "../syncback.js";
import { FakeRojo } from "./fake-rojo.js";
import { ROUTES } from "./layout-fixtures.js";
import { stagingOf, syncbackServiceOf } from "./syncback-of.js";

describe("MirrorPlanner", () => {
	let fs: MemoryFileSystemService;
	let rojo: FakeRojo;
	let service: CoreSyncbackService;
	let config: ResolvedConfig;

	const prepare = async (
		files: readonly string[],
		spec: Parameters<typeof configOf>[0] = {}
	) => {
		await writeFiles(fs, ...files);
		config = configOf({ routes: ROUTES, ...spec });
		await writeServiceOf(fs, new CoreIndexService(fs)).write(
			selectionOf(config)
		);
	};

	const planned = async (
		mode: SyncbackMode = "dryRun"
	): Promise<SyncbackResult> => {
		const { outcome } = await service.run(selectionOf(config), {
			input: "game.rbxl",
			cwd: "/repo",
			mode,
		});
		if (outcome.kind === "failed") throw outcome.error;
		if (outcome.kind === "notRun") throw new Error("syncback did not run");
		return { ...outcome.plan, warnings: outcome.warnings };
	};

	const mirror = (...instancePath: string[]) =>
		abs(".rogen-syncback/mirror", ...instancePath);

	const mountedTwice = async () => {
		await writeFiles(fs, "Packages/Lib.luau");
		await prepare(["src/Combat/Server/Combat.luau"], {
			project: {
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "Packages" } },
					ServerStorage: { Packages: { $path: "Packages" } },
				},
			},
		});
	};

	const compiled = async () => {
		await writeFiles(fs, "dist/Combat/Server/Combat.luau");
		await prepare(["src/Combat/Server/Combat.luau"], {
			compiledPath: abs("dist"),
		});
	};

	afterEach(() => {
		jest.restoreAllMocks();
	});

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		rojo = new FakeRojo();
		service = syncbackServiceOf({
			configService: new MockConfigService([]),
			fileSystemService: fs,
			writeService: writeServiceOf(fs, new CoreIndexService(fs)),
			rojoService: rojo,
			environmentService: new MockEnvironmentService("/repo"),
			processService: new MockProcessService(),
			lifecycleService: new MockLifecycleService(),
		});
	});

	describe("a folder mounted twice", () => {
		it("should write the edit to one copy of a file and keep it, listing the other copy's removal", async () => {
			await mountedTwice();
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ReplicatedStorage", "Packages", "Lib.luau"),
					"return 2"
				);
				await fs.delete(
					mirror("ServerStorage", "Packages", "Lib.luau")
				);
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual([
				{ kind: "write", file: abs("Packages/Lib.luau") },
			]);
			expect(plan.unplaced).toEqual([
				{
					instance: "ServerStorage/Packages/Lib",
					reason: `its file ${abs("Packages/Lib.luau")} is also ReplicatedStorage/Packages/Lib, which was edited, so the file was kept`,
				},
			]);
		});

		it("should write a file Studio added alike to both copies once", async () => {
			await mountedTwice();
			rojo.say = async () => {
				for (const service of ["ReplicatedStorage", "ServerStorage"]) {
					await fs.writeFile(
						mirror(service, "Packages", "New.luau"),
						"return 1"
					);
					await fs.createDirectory(
						mirror(service, "Packages", "Kit")
					);
				}
				return [];
			};

			const plan = await planned("apply");

			expect(plan.changes).toEqual([
				{ kind: "write", file: abs("Packages/Kit") },
				{ kind: "write", file: abs("Packages/New.luau") },
			]);
			expect(plan.unplaced).toEqual([]);
			expect(await fs.readFile(abs("Packages/New.luau"))).toBe(
				"return 1"
			);
		});

		it("should keep the first of two different files Studio added to the copies, and list the other", async () => {
			await mountedTwice();
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ReplicatedStorage", "Packages", "New.luau"),
					"return 1"
				);
				await fs.writeFile(
					mirror("ServerStorage", "Packages", "New.luau"),
					"return 2"
				);
				return [];
			};

			const plan = await planned("apply");

			expect(plan.unplaced).toEqual([
				{
					instance: "ServerStorage/Packages/New",
					reason: `${abs("Packages/New.luau")} is already there`,
				},
			]);
			expect(await fs.readFile(abs("Packages/New.luau"))).toBe(
				"return 1"
			);
		});

		it("should keep an empty folder Studio added to a mounted folder", async () => {
			await mountedTwice();
			rojo.say = async () => {
				await writeFiles(
					fs,
					".rogen-syncback/mirror/ReplicatedStorage/Packages/Kit/.gitkeep"
				);
				return [];
			};

			const plan = await planned("apply");

			expect(plan.changes).toEqual([
				{ kind: "write", file: abs("Packages/Kit/.gitkeep") },
			]);
		});

		it("should keep the .gitkeep Rojo wrote in a mounted folder Studio emptied", async () => {
			await mountedTwice();
			rojo.say = async () => {
				for (const service of ["ReplicatedStorage", "ServerStorage"])
					await fs.delete(mirror(service, "Packages", "Lib.luau"));
				await writeFiles(
					fs,
					".rogen-syncback/mirror/ReplicatedStorage/Packages/.gitkeep"
				);
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual([
				{ kind: "remove", file: abs("Packages/Lib.luau") },
				{ kind: "write", file: abs("Packages/.gitkeep") },
			]);
		});

		it("should write the meta Rojo wrote for a mounted folder that makes no feature where Rojo wrote it", async () => {
			await mountedTwice();
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ReplicatedStorage", "Packages", "init.meta.json"),
					'{"attributes":{"Owner":"you"}}'
				);
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual([
				{ kind: "write", file: abs("Packages/init.meta.json") },
			]);
		});

		it("should list what Rojo said it wrote in a mounted folder as the folder the plan writes into", async () => {
			await mountedTwice();
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ReplicatedStorage", "Packages", "Lib.luau"),
					"return 2"
				);
				await fs.delete(
					mirror("ServerStorage", "Packages", "Lib.luau")
				);
				return [
					`Writing ${path.join(".rogen-syncback", "mirror", "ReplicatedStorage", "Packages")}`,
					`Removing ${path.join(".rogen-syncback", "mirror", "ServerStorage", "Packages", "Lib.luau")}`,
					"Writing rogen-syncback.project.json",
				];
			};

			const plan = await planned();

			expect(plan.listed).toEqual([
				{ kind: "write", file: abs("Packages") },
				{ kind: "remove", file: abs("Packages/Lib.luau") },
			]);
		});
	});

	describe("with a compiledPath", () => {
		it("should list an instance Studio added where routing places it, and write nothing", async () => {
			await compiled();
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ServerScriptService", "Combat", "Hit.luau"),
					"return 1"
				);
				await writeFiles(
					fs,
					".rogen-syncback/mirror/ServerScriptService/Combat/.gitkeep"
				);
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual([]);
			expect(plan.compiled).toEqual([
				{ instance: "ServerScriptService/Combat/Hit", kind: "added" },
			]);
		});

		it("should leave out a meta Rojo wrote only for Studio's empty serialized overrides", async () => {
			await compiled();
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ServerScriptService", "Combat", "Combat.meta.json"),
					JSON.stringify({
						properties: {
							SerializedOverrides: { BinaryString: "" },
						},
					})
				);
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual([]);
			expect(plan.compiled).toEqual([]);
		});

		it("should list a property Studio set on a feature as a change to compiled code", async () => {
			await compiled();
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ServerScriptService", "Combat", "init.meta.json"),
					'{"attributes":{"Owner":"you"}}'
				);
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual([]);
			expect(plan.compiled).toEqual([
				{ instance: "ServerScriptService/Combat", kind: "changed" },
			]);
		});
	});

	describe("with a compiledPath and features routed by name", () => {
		beforeEach(async () => {
			await writeFiles(
				fs,
				"dist/Inventory/Bag@Server.luau",
				"dist/Inventory/Save@Server.luau",
				"dist/Combat/Server/Empty/.keep"
			);
			await fs.delete(abs("dist/Combat/Server/Empty/.keep"));
			await prepare(
				[
					"src/Inventory/Bag@Server.luau",
					"src/Inventory/Save@Server.luau",
				],
				{ compiledPath: abs("dist") }
			);
		});

		it("should list a property Studio set on a feature as a change to compiled code", async () => {
			rojo.say = async () => {
				await fs.writeFile(
					mirror(
						"ServerScriptService",
						"Inventory",
						"init.meta.json"
					),
					'{"attributes":{"Owner":"you"}}'
				);
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual([]);
			expect(plan.compiled).toEqual([
				{ instance: "ServerScriptService/Inventory", kind: "changed" },
			]);
		});

		it("should list a new feature routing places, and leave out the .gitkeep Rojo wrote beside it", async () => {
			rojo.say = async () => {
				await writeFiles(
					fs,
					".rogen-syncback/mirror/ServerScriptService/Shop/Buy.luau",
					".rogen-syncback/mirror/ServerScriptService/.gitkeep"
				);
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual([]);
			expect(plan.unplaced).toEqual([]);
			expect(plan.compiled).toEqual([
				{ instance: "ServerScriptService/Shop", kind: "added" },
			]);
		});
	});

	it("should list a new empty folder Studio added under the compiled code as an addition", async () => {
		await compiled();
		rojo.say = async () => {
			await writeFiles(
				fs,
				".rogen-syncback/mirror/ServerScriptService/Combat/Bag/.gitkeep"
			);
			return [];
		};

		const plan = await planned();

		expect(plan.changes).toEqual([]);
		expect(plan.compiled).toEqual([
			{ instance: "ServerScriptService/Combat/Bag", kind: "added" },
		]);
	});

	it("should change nothing for an empty folder of the compiled code that the mirror holds as it was", async () => {
		await writeFiles(fs, "dist/Combat/Server/Combat.luau");
		await fs.createDirectory(abs("dist/Combat/Server/Empty"));
		await prepare(["src/Combat/Server/Combat.luau"], {
			compiledPath: abs("dist"),
		});

		const plan = await planned();

		expect(plan.changes).toEqual([]);
		expect(plan.compiled).toEqual([]);
	});

	it("should place a child Studio added to an init script's folder routed by its name with the side it runs on", async () => {
		await prepare([
			"src/Net/init.luau",
			"src/Net/Types.luau",
			"src/Net/Server/Remote.luau",
			"src/Net/Client/Listener.luau",
		]);
		rojo.say = async () => {
			await writeFiles(
				fs,
				".rogen-syncback/mirror/ServerScriptService/Net/Added.luau"
			);
			return [];
		};

		const plan = await planned();

		expect(plan.changes).toEqual([
			{ kind: "write", file: abs("src/Net/Server/Added.luau") },
		]);
	});

	it("should write the meta Rojo wrote for a child of an init script routed by @ beside that child", async () => {
		await prepare([
			"src/Store/init@Client.luau",
			"src/Store/Client/Row.luau",
			"src/Store/Server/Save.luau",
		]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror(
					"StarterPlayer",
					"StarterPlayerScripts",
					"Store",
					"Row.meta.json"
				),
				'{"attributes":{"Owner":"you"}}'
			);
			return [];
		};

		const plan = await planned();

		expect(plan.changes).toEqual([
			{ kind: "write", file: abs("src/Store/Client/Row.meta.json") },
		]);
	});

	it("should list a folder Rojo said it removed as every folder of the project it emptied", async () => {
		await prepare(
			[
				"src/Inventory/Server/Bag.luau",
				"lib/Inventory/Server/Cart.luau",
				"lib/Inventory/Shared/Item.luau",
			],
			{ sourcePaths: [abs("src"), abs("lib")] }
		);
		rojo.say = async () => {
			await fs.delete(mirror("ServerScriptService", "Inventory"), true);
			return [
				`Removing ${path.join(".rogen-syncback", "mirror", "ServerScriptService", "Inventory")}`,
			];
		};

		const plan = await planned();

		expect(plan.listed).toEqual([
			{ kind: "remove", file: abs("lib/Inventory/Server") },
			{ kind: "remove", file: abs("src/Inventory") },
		]);
	});

	describe("with a node that has no $path", () => {
		const tree = {
			$className: "DataModel",
			ReplicatedStorage: {
				Remotes: {
					$className: "Folder",
					Hit: { $className: "RemoteEvent" },
				},
			},
		};

		const intoNode = async (...files: string[]) => {
			const written = JSON.parse(
				await fs.readFile(abs("rogen-syncback.project.json"))
			);
			const folder = written.tree.ReplicatedStorage.Remotes.$path;
			for (const file of files)
				if (file.endsWith("/"))
					await fs.createDirectory(abs(folder, file));
				else await fs.writeFile(abs(folder, file), "print(1)");
		};

		beforeEach(async () => {
			await prepare(["src/Combat/Server/Combat.luau"], {
				project: { tree },
			});
			await fs.writeFile(
				abs("default.rogen.json"),
				JSON.stringify({ tree }, undefined, "\t")
			);
		});

		it("should add an empty folder Studio added there to that node in the config's tree, listing the config first", async () => {
			rojo.say = async () => {
				await intoNode("Kit/");
				return [
					"Writing rogen-syncback.project.json",
					`Writing ${path.join(".rogen-syncback", "mirror")}`,
				];
			};

			const plan = await planned("apply");

			expect(plan.listed[0]).toEqual({
				kind: "write",
				file: abs("default.rogen.json"),
			});
			expect(
				JSON.parse(await fs.readFile(abs("default.rogen.json"))).tree
					.ReplicatedStorage.Remotes.Kit
			).toEqual({ $className: "Folder" });
		});

		it("should say how to keep a folder there that the tree can't describe", async () => {
			rojo.say = async () => {
				await intoNode("Kit/Run.server.luau");
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual([]);
			expect(plan.unplaced).toEqual([
				{
					instance: "ReplicatedStorage/Remotes/Kit",
					reason: `Rojo writes it as the folder Kit, and its parent ReplicatedStorage/Remotes is a node of the tree of ${abs("default.rogen.json")} with no $path; give that node a $path, or create the file by hand`,
				},
			]);
		});
	});

	describe("a meta Rojo wrote for a folder", () => {
		const writeMeta = (text: string, ...instancePath: string[]) =>
			fs.writeFile(mirror(...instancePath, "init.meta.json"), text);

		it.each([
			[
				"only Studio's empty serialized overrides",
				JSON.stringify({
					properties: { SerializedOverrides: { BinaryString: "" } },
				}),
			],
			["no object", "[]"],
			["nothing", "{}"],
		])(
			"should change nothing for a feature's meta that sets %s",
			async (_, text) => {
				await prepare(["src/Combat/Server/Main.server.luau"]);
				rojo.say = async () => {
					await writeMeta(text, "ServerScriptService", "Combat");
					return [];
				};

				const plan = await planned();

				expect(plan.changes).toEqual([]);
				expect(plan.unplaced).toEqual([]);
			}
		);

		it("should list a meta for a folder that no one folder of the project is", async () => {
			await prepare(["src/Combat/Server/Main.server.luau"]);
			rojo.say = async () => {
				await writeMeta(
					'{"attributes":{"Owner":"you"}}',
					"ServerScriptService"
				);
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual([]);
			expect(plan.unplaced).toEqual([
				{
					instance: "ServerScriptService",
					reason: expect.stringContaining(
						"no one folder of the project is this instance"
					),
				},
			]);
		});
	});

	it("should list an instance in a service no folder of the project holds", async () => {
		await prepare(["src/Combat/Server/Main.server.luau"]);
		rojo.say = async () => {
			await fs.writeFile(mirror("Lighting", "Sky.model.json"), "{}");
			return [];
		};

		const plan = await planned();

		expect(plan.unplaced).toEqual([
			{
				instance: "Lighting/Sky.model.json",
				reason: "no folder of the project holds its parent",
			},
		]);
	});

	it("should write nothing when a file of the project changed while Rojo ran", async () => {
		await prepare(["src/Combat/Server/Main.server.luau"]);
		rojo.say = async () => {
			await fs.delete(abs("src/Combat/Server/Main.server.luau"));
			return [];
		};

		await expect(planned()).rejects.toThrow(
			`${abs("src/Combat/Server/Main.server.luau")} changed while syncback ran, so nothing was written.`
		);
	});

	it("should take a copy Rojo left alone as unchanged without reading it", async () => {
		await prepare(["src/Combat/Server/Main.server.luau"]);
		const now = Date.now();
		jest.spyOn(Date, "now").mockReturnValue(now + 10_000);
		const read = jest.spyOn(fs, "readFileBytes");

		const plan = await planned();

		expect(plan.changes).toEqual([]);
		expect(read).not.toHaveBeenCalledWith(
			abs("src/Combat/Server/Main.server.luau")
		);
	});

	describe("an instance Studio moved where its script type has no place", () => {
		it("should keep the files of a script moved into a shared folder, and say why", async () => {
			await prepare([
				"src/Shop/Prices.luau",
				"src/Shop@Server/Main.server.luau",
				"src/Shop@Server/ShopService.luau",
			]);
			await fs.writeFile(
				abs("src/Shop@Server/Main.server.luau"),
				"print(1)"
			);
			await fs.writeFile(
				abs("src/Shop@Server/ShopService.luau"),
				"return 1"
			);
			rojo.say = async () => {
				await fs.delete(mirror("ServerScriptService", "Shop"), true);
				const moved = [
					"ReplicatedStorage",
					"Shared",
					"Shop",
					"ServerBits",
				];
				await fs.writeFile(
					mirror(...moved, "Main.server.luau"),
					"print(1)"
				);
				await fs.writeFile(
					mirror(...moved, "ShopService.luau"),
					"return 1"
				);
				return [];
			};

			const plan = await planned("apply");

			expect(plan.changes).toEqual([]);
			expect(
				await fs.exists(abs("src/Shop@Server/Main.server.luau"))
			).toBe(true);
			expect(
				await fs.exists(abs("src/Shop@Server/ShopService.luau"))
			).toBe(true);
			expect(plan.unplaced).toHaveLength(1);
		});
	});

	it("should leave a route's folder alone when Studio emptied it, as an empty route makes no instance", async () => {
		await prepare(["src/Combat/Shared/Hit.luau"]);
		rojo.say = async () => {
			await fs.delete(
				mirror("ReplicatedStorage", "Shared", "Combat"),
				true
			);
			await writeFiles(
				fs,
				".rogen-syncback/mirror/ReplicatedStorage/Shared/.gitkeep"
			);
			return [];
		};

		const plan = await planned();

		expect(plan.unplaced).toEqual([]);
		expect(plan.changes).toEqual([
			{ kind: "remove", file: abs("src/Combat") },
		]);
	});

	describe("a renamed feature", () => {
		it("should move the files of a feature Studio renamed into a folder of the new name", async () => {
			await prepare(["src/Shop/Server/ShopService.luau"]);
			await fs.writeFile(
				abs("src/Shop/Server/ShopService.luau"),
				"return 1"
			);
			rojo.say = async () => {
				await fs.delete(mirror("ServerScriptService", "Shop"), true);
				await fs.writeFile(
					mirror("ServerScriptService", "Store", "ShopService.luau"),
					"return 1"
				);
				return [];
			};

			await planned("apply");

			expect(
				await fs.readFile(abs("src/Store/Server/ShopService.luau"))
			).toBe("return 1");
			expect(await fs.exists(abs("src/Shop"))).toBe(false);
		});

		it("should move a renamed feature though a new empty folder in it has no sibling file to follow", async () => {
			await prepare(["src/Shop/Server/A/Hit.luau"]);
			rojo.say = async () => {
				await fs.delete(mirror("ServerScriptService", "Shop"), true);
				await writeFiles(
					fs,
					".rogen-syncback/mirror/ServerScriptService/Store/A/Hit.luau",
					".rogen-syncback/mirror/ServerScriptService/Store/Bag/.gitkeep"
				);
				return [];
			};

			await planned("apply");

			expect(await fs.exists(abs("src/Store/Server/A/Hit.luau"))).toBe(
				true
			);
			expect(await fs.exists(abs("src/Shop"))).toBe(false);
		});

		it("should carry the metas, data files and other files of a renamed feature into its new folder", async () => {
			await prepare([
				"src/Shop/Server/ShopService.luau",
				"src/Shop/Server/Items.json",
				"src/Shop/Server/notes.md",
			]);
			await fs.writeFile(abs("src/Shop/Server/Items.json"), "[1]");
			await fs.writeFile(abs("src/Shop/Server/notes.md"), "notes");
			await fs.writeFile(
				abs("src/Shop/Server/ShopService.meta.json"),
				"{}"
			);
			rojo.say = async () => {
				await fs.delete(mirror("ServerScriptService", "Shop"), true);
				await fs.writeFile(
					mirror("ServerScriptService", "Store", "ShopService.luau"),
					""
				);
				await fs.writeFile(
					mirror(
						"ServerScriptService",
						"Store",
						"ShopService.meta.json"
					),
					"{}"
				);
				await fs.writeFile(
					mirror("ServerScriptService", "Store", "Items.luau"),
					"return {1}"
				);
				await fs.createDirectory(
					mirror("ServerScriptService", "Store", "Empty")
				);
				return [];
			};

			await planned("apply");

			expect(await fs.readFile(abs("src/Store/Server/Items.json"))).toBe(
				"[1]"
			);
			expect(await fs.readFile(abs("src/Store/Server/notes.md"))).toBe(
				"notes"
			);
			expect(
				await fs.readFile(abs("src/Store/Server/ShopService.meta.json"))
			).toBe("{}");
			expect(await fs.isDirectory(abs("src/Store/Server/Empty"))).toBe(
				true
			);
			expect(await fs.exists(abs("src/Shop"))).toBe(false);
		});

		it("should move only the side Studio renamed, keeping its data files' form and leaving the other side's files", async () => {
			await prepare([
				"src/Shop/Server/ShopService.luau",
				"src/Shop/Server/Items.json",
				"src/Shop/Client/Hud.luau",
			]);
			await writeFiles(
				fs,
				"src/Shop/Server/Art/notes.md",
				"src/Shop/Docs/notes.md",
				"src/Shop/README.md"
			);
			await fs.writeFile(abs("src/Shop/Client/Hud.meta.json"), "{}");
			await fs.writeFile(abs("src/Shop/Server/Items.json"), "[1]");
			rojo.say = async () => {
				await fs.delete(mirror("ServerScriptService", "Shop"), true);
				await fs.writeFile(
					mirror("ServerScriptService", "Store", "ShopService.luau"),
					""
				);
				await fs.writeFile(
					mirror("ServerScriptService", "Store", "Items.luau"),
					"return {1}"
				);
				return [];
			};

			await planned("apply");

			expect(await fs.readFile(abs("src/Store/Server/Items.json"))).toBe(
				"[1]"
			);
			for (const file of [
				"src/Store/Server/ShopService.luau",
				"src/Store/Server/Art/notes.md",
				"src/Shop/Client/Hud.luau",
				"src/Shop/Client/Hud.meta.json",
				"src/Shop/Docs/notes.md",
				"src/Shop/README.md",
			])
				expect(await fs.exists(abs(file))).toBe(true);
			expect(await fs.exists(abs("src/Shop/Server"))).toBe(false);
		});

		it("should rename a feature whose old instance lost a script Studio deleted", async () => {
			await prepare([
				"src/Shop/Server/ShopService.luau",
				"src/Shop/Server/Gone.luau",
			]);
			rojo.say = async () => {
				await fs.delete(mirror("ServerScriptService", "Shop"), true);
				await writeFiles(
					fs,
					".rogen-syncback/mirror/ServerScriptService/Store/ShopService.luau"
				);
				return [];
			};

			await planned("apply");

			expect(
				await fs.exists(abs("src/Store/Server/ShopService.luau"))
			).toBe(true);
			expect(await fs.exists(abs("src/Store/Server/Gone.luau"))).toBe(
				false
			);
			expect(await fs.exists(abs("src/Shop"))).toBe(false);
		});

		it("should place a renamed feature by routing when a folder of the new name is already there", async () => {
			await prepare([
				"src/Shop/Server/ShopService.luau",
				"src/Store/notes.md",
			]);
			rojo.say = async () => {
				await fs.delete(mirror("ServerScriptService", "Shop"), true);
				await fs.writeFile(
					mirror("ServerScriptService", "Store", "ShopService.luau"),
					""
				);
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual(
				expect.arrayContaining([
					{ kind: "remove", file: abs("src/Shop") },
					{
						kind: "write",
						file: abs("src/Store/Server/ShopService.luau"),
					},
				])
			);
		});

		it("should move a file an ignore glob kept out of the mirror along with its renamed feature", async () => {
			await prepare(["src/Shop/Server/ShopService.luau"], {
				project: {
					tree: { $className: "DataModel" },
					globIgnorePaths: ["**/*.md"],
				},
			});
			await fs.writeFile(abs("src/Shop/Server/notes.md"), "notes");
			rojo.say = async () => {
				await fs.delete(mirror("ServerScriptService", "Shop"), true);
				await writeFiles(
					fs,
					".rogen-syncback/mirror/ServerScriptService/Store/ShopService.luau",
					".rogen-syncback/mirror/ServerScriptService/Store/Empty/.gitkeep"
				);
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual(
				expect.arrayContaining([
					{ kind: "write", file: abs("src/Store/Server/notes.md") },
					{
						kind: "write",
						file: abs("src/Store/Server/Empty/.gitkeep"),
					},
					{
						kind: "write",
						file: abs("src/Store/Server/ShopService.luau"),
					},
					{ kind: "remove", file: abs("src/Shop") },
				])
			);
		});

		it("should place a renamed feature by routing when an ignore glob names its new folder", async () => {
			await prepare(["src/Shop/Server/ShopService.luau"], {
				project: {
					tree: { $className: "DataModel" },
					syncbackRules: { ignorePaths: ["src/Store/**"] },
				},
			});
			rojo.say = async () => {
				await fs.delete(mirror("ServerScriptService", "Shop"), true);
				await writeFiles(
					fs,
					".rogen-syncback/mirror/ServerScriptService/Store/ShopService.luau"
				);
				return [];
			};

			const plan = await planned();

			expect(plan.unplaced).toEqual([
				{
					instance: "ServerScriptService/Store",
					reason: expect.stringContaining("matches an ignore glob"),
				},
			]);
		});

		it("should still move a renamed feature when a folder inside it can't be listed", async () => {
			await prepare([
				"src/Shop/Server/ShopService.luau",
				"src/Shop/Server/Util/Math.luau",
			]);
			rojo.say = async () => {
				await fs.delete(mirror("ServerScriptService", "Shop"), true);
				await writeFiles(
					fs,
					".rogen-syncback/mirror/ServerScriptService/Store/ShopService.luau",
					".rogen-syncback/mirror/ServerScriptService/Store/Util/Math.luau"
				);
				fs.refuseListing(abs("src/Shop/Server/Util"), "EACCES");
				return [];
			};

			const plan = await planned();

			expect(plan.changes).toEqual(
				expect.arrayContaining([
					{
						kind: "write",
						file: abs("src/Store/Server/Util/Math.luau"),
					},
					{ kind: "remove", file: abs("src/Shop") },
				])
			);
		});
	});

	it("should write the meta Rojo wrote for an instance the mirror holds at its root beside that instance's file", async () => {
		await writeFiles(fs, "src/Bag.luau");
		config = configOf({ routes: ROUTES });
		const bag: PlacedLocation = {
			status: "placed",
			source: toPosix(abs("src/Bag.luau")),
			exists: true,
			instancePath: ["Bag"],
			route: "Server",
			routeMatch: "suffix",
		};
		const layout = new SyncbackLayout(config, [bag], []);
		const written = { tree: { Bag: { $path: "src/Bag.luau" } } };
		const mirrored = await SyncbackMirror.of({
			written,
			tree: written.tree,
			routeTargets: [],
			dir: toPosix(abs()),
			root: MIRROR,
			placed: layout.placed,
			reads: [toPosix(abs("src"))],
			fileAt: (target) => RojoFile.at(target, SyncRules.DEFAULT),
			isFolder: async () => false,
			readText: async () => undefined,
		});
		const instantiation = instantiationOf(
			[FileSystemService, fs],
			[WriteService, writeServiceOf(fs, new CoreIndexService(fs))]
		);
		const workspace = instantiation.createInstance(
			MirrorWorkspace,
			{
				selection: selectionOf(config),
				project: config,
				input: "game.rbxl",
				cwd: abs(),
			},
			stagingOf(
				fs,
				new MockProcessService(),
				new MockLifecycleService(),
				1,
				abs()
			),
			written,
			mirrored,
			layout,
			[]
		);
		await fs.writeFile(mirror("Bag.meta.json"), "{}");

		const plan = (
			await instantiation.createInstance(MirrorPlanner, workspace).plan({
				copied: [],
				started: Date.now(),
				said: [],
				skipped: [],
			})
		).unwrap();

		expect(plan.changes).toEqual([
			{ kind: "write", file: abs("src/Bag.meta.json") },
		]);
	});
});
