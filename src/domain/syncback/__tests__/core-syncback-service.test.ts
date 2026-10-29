import path from "path";
import { Result, ResultError, ok } from "../../../base/result.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	abs,
	writeServiceOf,
	configOf,
	writeFiles,
} from "../../write/__tests__/fixtures.js";
import {
	MockConfigService,
	mockEntry,
	selectionOf,
} from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import {
	RojoCommandRequest,
	RojoCommandRun,
	RojoCommandService,
} from "../../runner/rojo-command-service.js";
import { ServerMessage } from "../../runner/rojo-server.js";
import { CoreSyncbackService } from "../core-syncback-service.js";
import { SyncbackRequest } from "../syncback.js";
import { ROUTES } from "./layout-fixtures.js";

/** A Rojo that records what it was asked and does what the test says it did. */
class FakeRojo implements RojoCommandService {
	declare readonly _serviceBrand: undefined;
	readonly requests: RojoCommandRequest[] = [];
	readonly projectTexts: string[] = [];
	say: (request: RojoCommandRequest) => Promise<string[] | Error> =
		async () => [];

	constructor(private readonly fs: MemoryFileSystemService) {}

	choose(): never {
		throw new Error("not used");
	}

	projects(): never {
		throw new Error("not used");
	}

	runBare(): never {
		throw new Error("not used");
	}

	async run(
		_selection: unknown,
		request: RojoCommandRequest
	): Promise<Result<RojoCommandRun, Error>> {
		this.requests.push(request);
		if (request.projectFile)
			this.projectTexts.push(await this.fs.readFile(request.projectFile));
		const said = await this.say(request);
		const project = request.project as ResolvedConfig;
		if (said instanceof Error)
			return ok({
				project,
				messages: [],
				failure: said as DiagnosticsError,
			});
		return ok({
			project,
			messages: said.map((text): ServerMessage => ({
				severity: "info",
				text,
			})),
		});
	}
}

describe("CoreSyncbackService", () => {
	let fs: MemoryFileSystemService;
	let configs: MockConfigService;
	let rojo: FakeRojo;
	let service: CoreSyncbackService;
	let config: ResolvedConfig;
	let request: SyncbackRequest;

	const prepare = async (
		files: readonly string[],
		spec: Parameters<typeof configOf>[0] = {}
	) => {
		await writeFiles(fs, ...files);
		config = configOf({ routes: ROUTES, ...spec });
		const selection = selectionOf(config);
		await writeServiceOf(fs, new CoreIndexService(fs)).write(selection);
		request = {
			selection,
			project: config,
			input: "game.rbxl",
			cwd: "/repo",
		};
	};

	/** A path in the mirror Rojo runs on, by instance path. */
	const mirror = (...instancePath: string[]) =>
		abs(".rogen-syncback/mirror", ...instancePath);

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		rojo = new FakeRojo(fs);
		configs = new MockConfigService([]);
		service = new CoreSyncbackService(
			configs,
			fs,
			writeServiceOf(fs, new CoreIndexService(fs)),
			rojo
		);
	});

	it("should run Rojo's syncback once, on a project file that mounts a mirror of the files by instance", async () => {
		await prepare(["src/Inventory/Bag@server.luau"]);
		let copied: string | undefined;
		rojo.say = async () => {
			copied = await fs.readFile(
				mirror("ServerScriptService", "Inventory", "Bag.luau")
			);
			return [];
		};

		await service.plan(request);

		expect(rojo.requests).toHaveLength(1);
		expect(rojo.requests[0]).toMatchObject({
			command: "syncback",
			flags: ["--input", "game.rbxl", "--non-interactive", "--list"],
			projectFile: abs("rogen-syncback.project.json"),
			since: "7.7.0",
		});
		expect(JSON.parse(rojo.projectTexts[0]).tree).toMatchObject({
			ServerScriptService: {
				$path: ".rogen-syncback/mirror/ServerScriptService",
			},
		});
		expect(copied).toBe("");
	});

	it("should name the project file Rojo runs on after the folder when the config names none, as Rojo names a default one", async () => {
		await prepare(["src/Inventory/Bag@server.luau"]);

		await service.plan(request);

		expect(JSON.parse(rojo.projectTexts[0]).name).toBe("repo");
	});

	it("should keep the name the config gives the project", async () => {
		await prepare(["src/Inventory/Bag@server.luau"], {
			name: "Inventory",
			project: { name: "Inventory", tree: { $className: "DataModel" } },
		});

		await service.plan(request);

		expect(JSON.parse(rojo.projectTexts[0]).name).toBe("Inventory");
	});

	it("should leave no file of its own behind, after a plan or a run", async () => {
		await prepare(["src/Combat/Server/Combat.luau"]);

		await service.plan(request);
		await service.apply(request);

		expect(await fs.exists(abs("rogen-syncback.project.json"))).toBe(false);
		expect(await fs.exists(abs(".rogen-syncback"))).toBe(false);
	});

	it("should write an edit into the source file, with the line endings it had", async () => {
		await prepare([]);
		await fs.writeFile(
			abs("src/Inventory/Bag@server.luau"),
			"return 1\r\n"
		);
		await prepare([]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Inventory", "Bag.luau"),
				"return 2\n"
			);
			return [];
		};

		const result = (await service.apply(request)).unwrap();

		expect(result.changes).toEqual([
			{ kind: "write", file: abs("src/Inventory/Bag@server.luau") },
		]);
		expect(await fs.readFile(abs("src/Inventory/Bag@server.luau"))).toBe(
			"return 2\r\n"
		);
	});

	it("should list what Rojo listed, in its order and as the project's paths, and leave out what the plan does not touch", async () => {
		await prepare([
			"src/Inventory/Bag@server.luau",
			"src/Combat/Hit@server.luau",
		]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Inventory", "Bag.luau"),
				"return 1"
			);
			await fs.writeFile(
				mirror("ServerScriptService", "Combat", "Hit.luau"),
				"return 2"
			);
			return [
				"Writing .rogen-syncback/mirror/ServerScriptService/Inventory/Bag.luau",
				"Writing .rogen-syncback/mirror/ServerScriptService/Untouched.luau",
				"Writing .rogen-syncback/mirror/ServerScriptService/Combat/Hit.luau",
			];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(plan.listed).toEqual([
			{ kind: "write", file: abs("src/Inventory/Bag@server.luau") },
			{ kind: "write", file: abs("src/Combat/Hit@server.luau") },
		]);
	});

	it("should list a new instance at the file routing puts it in, where Rojo listed it", async () => {
		await prepare(["src/Inventory/Bag@server.luau"]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Inventory", "Added.luau"),
				"return 3"
			);
			return [
				"Writing .rogen-syncback/mirror/ServerScriptService/Inventory/Added.luau",
			];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(plan.listed).toEqual(plan.changes);
		expect(plan.listed).toHaveLength(1);
		expect(plan.listed[0].file).toContain("Added");
	});

	it("should keep one change and list the other when two copies of an init script were edited differently", async () => {
		await prepare([
			"src/Net/init.luau",
			"src/Net/Types.luau",
			"src/Net/Server/Remote.luau",
		]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ReplicatedStorage", "Shared", "Net", "init.luau"),
				"return 1"
			);
			await fs.writeFile(
				mirror("ServerScriptService", "Net", "init.luau"),
				"return 2"
			);
			return [];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([
			{ kind: "write", file: abs("src/Net/init.luau") },
		]);
		expect(plan.unplaced).toMatchObject([
			{
				instance: "ServerScriptService/Net",
				reason: expect.stringContaining("edited differently"),
			},
		]);
		await service.apply(request);
		expect(await fs.readFile(abs("src/Net/init.luau"))).toBe("return 1");
	});

	it("should write a file once when its copies were edited the same way", async () => {
		await prepare([
			"src/Net/init.luau",
			"src/Net/Types.luau",
			"src/Net/Server/Remote.luau",
		]);
		rojo.say = async () => {
			for (const folder of [
				["ReplicatedStorage", "Shared", "Net"],
				["ServerScriptService", "Net"],
			])
				await fs.writeFile(mirror(...folder, "init.luau"), "return 1");
			return [];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([
			{ kind: "write", file: abs("src/Net/init.luau") },
		]);
		expect(plan.unplaced).toEqual([]);
	});

	it("should remove a file once when all its copies were deleted", async () => {
		await prepare([
			"src/Net/init.luau",
			"src/Net/Types.luau",
			"src/Net/Server/Remote.luau",
		]);
		rojo.say = async () => {
			for (const folder of [
				["ReplicatedStorage", "Shared", "Net"],
				["ServerScriptService", "Net"],
			])
				await fs.delete(mirror(...folder, "init.luau"));
			return [];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([
			{ kind: "remove", file: abs("src/Net/init.luau") },
		]);
		expect(plan.unplaced).toEqual([]);
	});

	it("should keep a file that one copy edited and another deleted", async () => {
		await prepare([
			"src/Net/init.luau",
			"src/Net/Types.luau",
			"src/Net/Server/Remote.luau",
		]);
		rojo.say = async () => {
			await fs.delete(
				mirror("ReplicatedStorage", "Shared", "Net", "init.luau")
			);
			await fs.writeFile(
				mirror("ServerScriptService", "Net", "init.luau"),
				"return 2"
			);
			return [];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([
			{ kind: "write", file: abs("src/Net/init.luau") },
		]);
		expect(plan.unplaced).toMatchObject([
			{
				instance: "ReplicatedStorage/Shared/Net",
				reason: expect.stringContaining("edited"),
			},
		]);
		await service.apply(request);
		expect(await fs.readFile(abs("src/Net/init.luau"))).toBe("return 2");
	});

	it("should delete the files of an instance the place no longer holds, in any layout", async () => {
		await prepare([
			"src/Inventory/Bag@server.luau",
			"src/Inventory/Bag@server.meta.json",
			"src/Inventory/Save@server.luau",
		]);
		rojo.say = async () => {
			await fs.delete(
				mirror("ServerScriptService", "Inventory", "Bag.luau")
			);
			await fs.delete(
				mirror("ServerScriptService", "Inventory", "Bag.meta.json")
			);
			return [];
		};

		const result = (await service.apply(request)).unwrap();

		expect(result.changes).toEqual([
			{ kind: "remove", file: abs("src/Inventory/Bag@server.luau") },
			{ kind: "remove", file: abs("src/Inventory/Bag@server.meta.json") },
		]);
		expect(await fs.exists(abs("src/Inventory/Bag@server.luau"))).toBe(
			false
		);
		expect(await fs.exists(abs("src/Inventory/Save@server.luau"))).toBe(
			true
		);
	});

	it("should write a meta file Rojo adds beside the source file, under its name", async () => {
		await prepare(["src/Inventory/Bag@server.luau"]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Inventory", "Bag.meta.json"),
				"{}"
			);
			return [];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([
			{ kind: "write", file: abs("src/Inventory/Bag@server.meta.json") },
		]);
	});

	it("should place a new instance beside its siblings, in their style", async () => {
		await prepare([
			"src/Inventory/Bag@server.luau",
			"src/Inventory/Save@server.luau",
		]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Inventory", "Mail.luau"),
				"return 1"
			);
			return [];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([
			{ kind: "write", file: abs("src/Inventory/Mail@server.luau") },
		]);
	});

	it("should say why an instance has no place, and not write it", async () => {
		await prepare(
			["src/Inventory/Server/Bag.luau", "lib/Inventory/Server/Cart.luau"],
			{ sourcePaths: [abs("src"), abs("lib")] }
		);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Inventory", "Mail.luau"),
				"return 1"
			);
			return [];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([]);
		expect(plan.unplaced).toMatchObject([
			{
				instance: "ServerScriptService/Inventory/Mail",
				reason: expect.stringContaining("more than one place"),
			},
		]);
	});

	it("should write a new folder where routing puts it, and check it lands there", async () => {
		await prepare(["src/Combat/Server/Combat.luau"]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Quest", "Main.luau"),
				"return 1"
			);
			return [];
		};

		const result = (await service.apply(request)).unwrap();

		expect(await fs.readFile(abs("src/Quest/Server/Main.luau"))).toBe(
			"return 1"
		);
		expect(result.changes).toEqual([
			{ kind: "write", file: abs("src/Quest/Server/Main.luau") },
		]);
		expect(result.warnings).toEqual([]);
	});

	it("should write a new feature into the one source path no other config beside it lists", async () => {
		await prepare(["shared/Combat/Server/Combat.luau"], {
			file: abs("game.rogen.json"),
			sourcePaths: [abs("shared"), abs("place")],
		});
		configs.entries = [
			mockEntry({}, abs("game.rogen.json")),
			mockEntry(
				{ sourcePaths: [abs("shared"), abs("lobby")] },
				abs("lobby.rogen.json")
			),
		];
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Quest", "Main.luau"),
				"return 1"
			);
			return [];
		};

		const result = (await service.apply(request)).unwrap();

		expect(await fs.readFile(abs("place/Quest/Server/Main.luau"))).toBe(
			"return 1"
		);
		expect(result.warnings).toEqual([]);
	});

	it("should not overwrite a file that is already where a new instance would go", async () => {
		await prepare(["src/Combat/Server/Combat.luau"]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Quest", "Main.luau"),
				"return 1"
			);
			await fs.writeFile(abs("src/Quest/Server/Main.luau"), "kept");
			return [];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([]);
		expect(plan.unplaced).toMatchObject([
			{ reason: expect.stringContaining("already there") },
		]);
	});

	it("should place an empty folder the place added", async () => {
		await prepare([
			"src/Inventory/Bag@server.luau",
			"src/Inventory/Save@server.luau",
		]);
		rojo.say = async () => {
			await fs.createDirectory(
				mirror("ServerScriptService", "Inventory", "Empty")
			);
			return [];
		};

		await service.apply(request);

		expect(await fs.isDirectory(abs("src/Inventory/Empty@server"))).toBe(
			true
		);
	});

	it("should change nothing for a folder the project keeps empty that the place still holds empty", async () => {
		await prepare([
			"src/Inventory/Server/.gitkeep",
			"src/Inventory/Shared/Types.luau",
		]);

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([]);
		expect(plan.unplaced).toEqual([]);
	});

	it("should mirror a folder the tree mounts too, so a plan writes nothing outside the mirror", async () => {
		await writeFiles(fs, "Packages/Lib.luau");
		await prepare(["src/Combat/Server/Combat.luau"], {
			project: {
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "Packages" } },
				},
			},
		});
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ReplicatedStorage", "Packages", "Lib.luau"),
				"return 2"
			);
			return [];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(JSON.parse(rojo.projectTexts[0]).tree.ReplicatedStorage).toEqual(
			{
				Packages: {
					$path: ".rogen-syncback/mirror/ReplicatedStorage/Packages",
				},
			}
		);
		expect(plan.changes).toEqual([
			{ kind: "write", file: abs("Packages/Lib.luau") },
		]);
		expect(await fs.readFile(abs("Packages/Lib.luau"))).toBe("");
	});

	describe("with a compiledPath", () => {
		const compiled = async () => {
			await writeFiles(
				fs,
				"Packages/Lib.luau",
				"dist/Combat/Server/Combat.luau",
				"dist/Combat/Server/Hit.luau"
			);
			await prepare(
				["src/Combat/Server/Combat.luau", "src/Combat/Server/Hit.luau"],
				{
					compiledPath: abs("dist"),
					project: {
						tree: {
							$className: "DataModel",
							ReplicatedStorage: {
								Packages: { $path: "Packages" },
							},
						},
					},
				}
			);
		};

		it("should write an edit to a folder the tree mounts", async () => {
			await compiled();
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ReplicatedStorage", "Packages", "Lib.luau"),
					"return 2"
				);
				return [];
			};

			const result = (await service.apply(request)).unwrap();

			expect(result.changes).toEqual([
				{ kind: "write", file: abs("Packages/Lib.luau") },
			]);
			expect(await fs.readFile(abs("Packages/Lib.luau"))).toBe(
				"return 2"
			);
		});

		it("should list an edit to compiled code, and write nothing into the compiled path", async () => {
			await compiled();
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ServerScriptService", "Combat", "Combat.luau"),
					"return 2"
				);
				return [];
			};

			const result = (await service.apply(request)).unwrap();

			expect(result.changes).toEqual([]);
			expect(result.unplaced).toEqual([]);
			expect(result.compiled).toEqual([
				{
					instance: "ServerScriptService/Combat/Combat",
					kind: "changed",
				},
			]);
			expect(
				await fs.readFile(abs("dist/Combat/Server/Combat.luau"))
			).toBe("");
		});

		it("should list a removed and a new script, and write neither", async () => {
			await compiled();
			rojo.say = async () => {
				await fs.delete(
					mirror("ServerScriptService", "Combat", "Hit.luau")
				);
				await fs.writeFile(
					mirror("ServerScriptService", "Combat", "Loot.luau"),
					"return 1"
				);
				return [];
			};

			const result = (await service.apply(request)).unwrap();

			expect(result.changes).toEqual([]);
			expect(result.unplaced).toEqual([]);
			expect(result.compiled).toEqual([
				{ instance: "ServerScriptService/Combat/Hit", kind: "removed" },
				{ instance: "ServerScriptService/Combat/Loot", kind: "added" },
			]);
			expect(await fs.exists(abs("dist/Combat/Server/Hit.luau"))).toBe(
				true
			);
			expect(await fs.exists(abs("src/Combat/Server/Loot.luau"))).toBe(
				false
			);
		});

		it("should list a property Rojo wrote beside a compiled script as a change to that script", async () => {
			await compiled();
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ServerScriptService", "Combat", "Combat.meta.json"),
					"{}"
				);
				return [];
			};

			const result = (await service.apply(request)).unwrap();

			expect(result.compiled).toEqual([
				{
					instance: "ServerScriptService/Combat/Combat",
					kind: "changed",
				},
			]);
		});

		it("should list a removed folder once, and not each script in it", async () => {
			await compiled();
			rojo.say = async () => {
				await fs.delete(mirror("ServerScriptService", "Combat"), true);
				return [];
			};

			const result = (await service.apply(request)).unwrap();

			expect(result.compiled).toEqual([
				{ instance: "ServerScriptService/Combat", kind: "removed" },
			]);
		});

		it("should list a property set on a compiled folder as a change, beside the changes in it", async () => {
			await compiled();
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ServerScriptService", "Combat", "init.meta.json"),
					'{"attributes":{"Level":3}}'
				);
				await fs.delete(
					mirror("ServerScriptService", "Combat", "Hit.luau")
				);
				return [];
			};

			const result = (await service.apply(request)).unwrap();

			expect(result.compiled).toEqual([
				{ instance: "ServerScriptService/Combat", kind: "changed" },
				{ instance: "ServerScriptService/Combat/Hit", kind: "removed" },
			]);
		});

		it("should list a compiled script Rojo writes in another form as changed, not removed", async () => {
			await compiled();
			rojo.say = async () => {
				await fs.delete(
					mirror("ServerScriptService", "Combat", "Combat.luau")
				);
				await fs.writeFile(
					mirror(
						"ServerScriptService",
						"Combat",
						"Combat",
						"init.luau"
					),
					"return 2"
				);
				return [];
			};

			const result = (await service.apply(request)).unwrap();

			expect(result.compiled).toEqual([
				{
					instance: "ServerScriptService/Combat/Combat",
					kind: "changed",
				},
			]);
		});

		it("should list a change inside a changed module too", async () => {
			await writeFiles(
				fs,
				"dist/Combat/Server/Mod/init.luau",
				"dist/Combat/Server/Mod/Child.luau"
			);
			await prepare(
				[
					"src/Combat/Server/Mod/init.luau",
					"src/Combat/Server/Mod/Child.luau",
				],
				{ compiledPath: abs("dist") }
			);
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ServerScriptService", "Combat", "Mod", "init.luau"),
					"return 2"
				);
				await fs.writeFile(
					mirror(
						"ServerScriptService",
						"Combat",
						"Mod",
						"Child.luau"
					),
					"return 2"
				);
				return [];
			};

			const result = (await service.apply(request)).unwrap();

			expect(result.compiled).toEqual([
				{ instance: "ServerScriptService/Combat/Mod", kind: "changed" },
				{
					instance: "ServerScriptService/Combat/Mod/Child",
					kind: "changed",
				},
			]);
		});

		it("should say why a new instance has no place, as without a compiled path", async () => {
			await prepare(
				[
					"src/Inventory/Server/Bag.luau",
					"lib/Inventory/Server/Cart.luau",
				],
				{
					sourcePaths: [abs("src"), abs("lib")],
					compiledPath: abs("dist"),
				}
			);
			rojo.say = async () => {
				await fs.writeFile(
					mirror("ServerScriptService", "Inventory", "Mail.luau"),
					"return 1"
				);
				return [];
			};

			const plan = (await service.plan(request)).unwrap();

			expect(plan.compiled).toEqual([]);
			expect(plan.unplaced).toMatchObject([
				{
					instance: "ServerScriptService/Inventory/Mail",
					reason: expect.stringContaining("more than one place"),
				},
			]);
		});
	});

	it("should keep the files an ignore glob left out when it removes a folder", async () => {
		await writeFiles(fs, "vendor/kit/A.luau", "vendor/kit/A.spec.luau");
		await prepare(["src/Combat/Server/Combat.luau"], {
			project: {
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Kit: { $path: "vendor/kit" } },
				},
				globIgnorePaths: ["**/*.spec.luau"],
			},
		});
		rojo.say = async () => {
			await fs.delete(mirror("ReplicatedStorage", "Kit"), true);
			return [];
		};

		await service.apply(request);

		expect(await fs.exists(abs("vendor/kit/A.luau"))).toBe(false);
		expect(await fs.exists(abs("vendor/kit/A.spec.luau"))).toBe(true);
	});

	it("should remove a folder inside a mounted folder once Rojo emptied it", async () => {
		await writeFiles(fs, "Packages/Kit/.gitkeep");
		await prepare(["src/Combat/Server/Combat.luau"], {
			project: {
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Packages: { $path: "Packages" } },
				},
			},
		});
		rojo.say = async () => {
			await fs.delete(
				mirror("ReplicatedStorage", "Packages", "Kit"),
				true
			);
			await fs.writeFile(
				mirror("ReplicatedStorage", "Packages", "Kit.rbxm"),
				"model"
			);
			return [];
		};

		await service.apply(request);

		expect(await fs.exists(abs("Packages/Kit"))).toBe(false);
		expect(await fs.readFile(abs("Packages/Kit.rbxm"))).toBe("model");
	});

	it("should copy a file syncback's ignorePaths name, since Rojo still reads it", async () => {
		await writeFiles(fs, "vendor/kit/init.luau");
		await prepare(["src/Combat/Server/Combat.luau"], {
			project: {
				tree: {
					$className: "DataModel",
					ReplicatedStorage: { Kit: { $path: "vendor/kit" } },
				},
				syncbackRules: { ignorePaths: ["**/kit/*.luau"] },
			},
		});
		let copied = false;
		rojo.say = async () => {
			copied = await fs.exists(
				mirror("ReplicatedStorage", "Kit", "init.luau")
			);
			return [];
		};

		await service.plan(request);

		expect(copied).toBe(true);
	});

	it("should list a property Rojo wrote for a folder no one folder of the project is", async () => {
		await prepare([
			"src/Inventory/Bag@server.luau",
			"src/Inventory/Save@server.luau",
		]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Inventory", "init.meta.json"),
				"{}"
			);
			return [];
		};

		const plan = (await service.plan(request)).unwrap();

		expect(plan.changes).toEqual([]);
		expect(plan.unplaced).toMatchObject([
			{
				instance: "ServerScriptService/Inventory",
				reason: expect.stringContaining("init.meta.json"),
			},
		]);
	});

	it("should not write a file whose only difference is its line endings", async () => {
		await prepare([]);
		await fs.writeFile(
			abs("src/Inventory/Bag@server.luau"),
			"return 1\r\n"
		);
		await prepare([]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Inventory", "Bag.luau"),
				"return 1\n"
			);
			return [];
		};

		expect((await service.plan(request)).unwrap().changes).toEqual([]);
	});

	it("should list an instance Rojo says it can't sync back", async () => {
		await prepare(["src/Inventory/Bag@server.luau"]);
		rojo.say = async () => [
			"[WARN  librojo::syncback] Cannot syncback Json at ReplicatedStorage/Shared/Data, skipping",
		];

		const plan = (await service.plan(request)).unwrap();

		expect(plan.unplaced).toEqual([
			{
				instance: "ReplicatedStorage/Shared/Data",
				reason: "Rojo can't sync back a Json file, so its change stays in the place; copy it by hand",
			},
		]);
	});

	it("should write the plan it was shown without running Rojo again", async () => {
		await prepare(["src/Inventory/Bag@server.luau"]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Inventory", "Bag.luau"),
				"return 2"
			);
			return [];
		};
		const shown = (await service.plan(request)).unwrap();

		const result = (await service.apply(request, shown)).unwrap();

		expect(rojo.requests).toHaveLength(1);
		expect(result.changes).toEqual(shown.changes);
		expect(await fs.readFile(abs("src/Inventory/Bag@server.luau"))).toBe(
			"return 2"
		);
	});

	it("should write nothing when a source changed since the plan was shown", async () => {
		await prepare(["src/Inventory/Bag@server.luau"]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Inventory", "Bag.luau"),
				"return 2"
			);
			return [];
		};
		const shown = (await service.plan(request)).unwrap();
		await fs.writeFile(abs("src/Inventory/Bag@server.luau"), "edited");

		const applied = await service.apply(request, shown);

		expect(applied.isErr()).toBe(true);
		expect(await fs.readFile(abs("src/Inventory/Bag@server.luau"))).toBe(
			"edited"
		);
	});

	it("should list a file it could not write, and write the rest", async () => {
		await prepare(["src/Combat/Server/Combat.luau"]);
		rojo.say = async () => {
			await fs.writeFile(
				mirror("ServerScriptService", "Quest", "A.luau"),
				"a"
			);
			await fs.writeFile(
				mirror("ServerScriptService", "Raid", "B.luau"),
				"b"
			);
			return [];
		};
		const write = fs.writeFileBytes.bind(fs);
		fs.writeFileBytes = async (file, bytes) => {
			if (file.includes("Quest")) throw new Error("denied");
			return write(file, bytes);
		};

		const result = (await service.apply(request)).unwrap();

		expect(await fs.exists(abs("src/Raid/Server/B.luau"))).toBe(true);
		expect(result.changes).toEqual([
			{ kind: "write", file: abs("src/Raid/Server/B.luau") },
		]);
		expect(result.unplaced).toMatchObject([
			{ reason: expect.stringContaining("denied") },
		]);
	});

	it("should name the file to delete when Rojo refuses to remove an instance a project file defines", async () => {
		await prepare([
			"src/Inventory/Bag@server.luau",
			"src/Inventory/Save@server.luau",
		]);
		rojo.say = async () =>
			new DiagnosticsError([
				errorDiagnostic(
					"rojo.commandFailed",
					{ resource: abs("rogen-syncback.project.json") },
					"'rojo syncback' failed (exit code 1): Failed to syncback because The child 'Bag' of Instance 'Inventory' is present only in a project file, and not the provided file."
				),
			]);

		const planned = await service.plan(request);

		expect(planned.isErr()).toBe(true);
		const error = (planned as ResultError<DiagnosticsError>).error;
		expect(error.diagnostics).toMatchObject([
			{
				code: "syncback.removedFromProjectFile",
				message: expect.stringContaining(
					path
						.join("src", "Inventory", "Bag@server.luau")
						.replaceAll("\\", "/")
						.split("/")
						.join(path.sep)
				),
			},
		]);
	});

	it("should hand Rojo a project file it did not write as it is", async () => {
		await writeFiles(fs, "src/A.luau");
		await fs.writeFile(abs("default.project.json"), "{}");
		config = configOf({ file: abs("default.project.json") });
		request = {
			selection: selectionOf(config),
			project: config,
			input: "game.rbxl",
			cwd: "/repo",
		};

		await service.plan(request);

		expect(rojo.requests[0].projectFile).toBe(abs("default.project.json"));
		expect(await fs.exists(abs("rogen-syncback.project.json"))).toBe(false);
	});

	it("should fail with Rojo's error when it fails for another reason", async () => {
		await prepare(["src/Combat/Server/Combat.luau"]);
		const failure = new DiagnosticsError([
			errorDiagnostic(
				"rojo.commandFailed",
				{ resource: abs("x") },
				"no such file"
			),
		]);
		rojo.say = async () => failure;

		expect(((await service.plan(request)) as { error: Error }).error).toBe(
			failure
		);
	});

	it("should plan from what a write would write, with no project file on disk", async () => {
		await writeFiles(fs, "src/A.luau");
		config = configOf({ routes: ROUTES });
		request = {
			selection: selectionOf(config),
			project: config,
			input: "x",
			cwd: "/repo",
		};

		const planned = await service.plan(request);

		expect(planned.isOk()).toBe(true);
		expect(await fs.exists(abs("default.project.json"))).toBe(false);
	});

	it("should say when the project does not build", async () => {
		config = configOf({ routes: ROUTES });
		request = {
			selection: selectionOf(config),
			project: config,
			input: "x",
			cwd: "/repo",
		};

		const planned = await service.plan(request);

		expect((planned as ResultError<Error>).error.message).toContain(
			"does not build"
		);
	});
});
