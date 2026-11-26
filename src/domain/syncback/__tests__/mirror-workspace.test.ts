import { jest } from "@jest/globals";
import { err, ResultError } from "../../../base/result.js";
import { toPosix } from "../../../base/path.js";
import { errorDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { fileSystemError } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import {
	MockConfigService,
	brokenEntry,
	mockEntry,
	selectionOf,
} from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import {
	abs,
	configOf,
	writeFiles,
	writeServiceOf,
} from "../../write/__tests__/fixtures.js";
import { WriteService } from "../../write/write-service.js";
import { SyncbackOutcome } from "../syncback.js";
import { FakeRojo } from "./fake-rojo.js";
import { ROUTES } from "./layout-fixtures.js";
import { syncbackServiceOf, workspaceOpenerOf } from "./syncback-of.js";

describe("MirrorWorkspace", () => {
	let fs: MemoryFileSystemService;
	let configs: MockConfigService;
	let writeService: WriteService;
	let rojo: FakeRojo;

	const fakes = () => ({
		configService: configs,
		fileSystemService: fs,
		writeService,
		rojoService: rojo,
		environmentService: new MockEnvironmentService("/repo"),
		processService: new MockProcessService(),
		lifecycleService: new MockLifecycleService(),
	});

	const requestOf = (config: ResolvedConfig) => ({
		selection: selectionOf(config),
		project: config,
		input: "game.rbxl",
		cwd: "/repo",
	});

	const prepared = async (
		files: readonly string[],
		spec: Parameters<typeof configOf>[0] = {}
	): Promise<ResolvedConfig> => {
		await writeFiles(fs, ...files);
		const config = configOf({ routes: ROUTES, ...spec });
		await writeService.write(selectionOf(config));
		return config;
	};

	const syncback = async (config: ResolvedConfig): Promise<SyncbackOutcome> =>
		(
			await syncbackServiceOf(fakes()).run(selectionOf(config), {
				input: "game.rbxl",
				cwd: "/repo",
				mode: "dryRun",
			})
		).outcome;

	const failureOf = (outcome: SyncbackOutcome): Error => {
		if (outcome.kind !== "failed")
			throw new Error(`syncback ended ${outcome.kind}`);
		return outcome.error;
	};

	const mirror = (...instancePath: string[]) =>
		abs(".rogen-syncback/mirror", ...instancePath);

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		configs = new MockConfigService([]);
		writeService = writeServiceOf(fs);
		rojo = new FakeRojo();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("should say when the project does not build", async () => {
		const opened = await workspaceOpenerOf(fakes()).open(
			requestOf(configOf({ routes: ROUTES }))
		);

		expect((opened as ResultError<Error>).error.message).toContain(
			"does not build"
		);
	});

	it("should pass on why the projects could not be located", async () => {
		const failure = new DiagnosticsError([
			errorDiagnostic("rojo.failed", { resource: "/repo" }, "no"),
		]);
		jest.spyOn(writeService, "locate").mockResolvedValue(err(failure));

		const opened = await workspaceOpenerOf(fakes()).open(
			requestOf(configOf({ routes: ROUTES }))
		);

		expect((opened as ResultError<Error>).error).toBe(failure);
	});

	it("should refuse files whose instances differ only in letter case", async () => {
		const config = await prepared([
			"src/Inventory/Bag@Server.luau",
			"src/Inventory/bag@Server.luau",
		]);

		const opened = await workspaceOpenerOf(fakes()).open(requestOf(config));

		expect((opened as ResultError<Error>).error.message).toContain(
			`${abs("src/Inventory/Bag@Server.luau")} and ${abs("src/Inventory/bag@Server.luau")} make instances whose names differ only in letter case`
		);
	});

	it("should take its own source path as the one no other config of the folder reads, skipping a config that never loaded", async () => {
		const config = await prepared(
			["shared/Lib/Shared/A.luau", "game/Combat/Server/B.luau"],
			{ sourcePaths: [abs("shared"), abs("game")] }
		);
		configs.entries = [
			mockEntry({}, config.file),
			brokenEntry([], abs("broken.rogen.json")),
			mockEntry(
				{ sourcePaths: [abs("shared")] },
				abs("lobby.rogen.json")
			),
		];

		const opened = (
			await workspaceOpenerOf(fakes()).open(requestOf(config))
		).unwrap();

		expect(opened.layout.ownSourcePath).toBe(toPosix(abs("game")));
	});

	it("should copy a nested project the tree mounts, and one it names that is missing", async () => {
		await fs.writeFile(
			abs("vendor/kit.project.json"),
			JSON.stringify({
				tree: {
					Gone: { $path: "gone.project.json" },
					Lib: { $path: "lib" },
				},
			})
		);
		await writeFiles(fs, "vendor/lib/A.luau");
		const config = await prepared(["src/Combat/Server/Combat.luau"], {
			project: {
				tree: {
					$className: "DataModel",
					ReplicatedStorage: {
						Kit: { $path: "vendor/kit.project.json" },
					},
				},
			},
		});
		let copied: string[] = [];
		rojo.say = async () => {
			copied = (await fs.readDirectory(mirror("~kept", "0"))).map(
				([name]) => name
			);
			return [];
		};

		await syncback(config);

		expect(copied).toEqual(["kit.project.json", "lib"]);
	});

	it("should fail when it can't tell whether a file of the project changed while Rojo ran", async () => {
		const config = await prepared(["src/Combat/Server/Combat.luau"]);
		const refused = fileSystemError("EACCES", "permission denied");
		rojo.say = async () => {
			const lastModified = fs.lastModified.bind(fs);
			jest.spyOn(fs, "lastModified").mockImplementation(async (file) => {
				if (file === abs("src/Combat/Server/Combat.luau"))
					throw refused;
				return lastModified(file);
			});
			return [];
		};

		expect(failureOf(await syncback(config)).message).toBe(
			"Syncback could not finish: permission denied. Run syncback again."
		);
	});

	describe("with a folder the tree mounts", () => {
		const mountingKit = async () => {
			await writeFiles(fs, "vendor/kit/A.luau");
			return prepared(["src/Combat/Server/Combat.luau"], {
				project: {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: { Kit: { $path: "vendor/kit" } },
					},
				},
			});
		};

		const listingFails = (failure: Error) => {
			const readDirectory = fs.readDirectory.bind(fs);
			jest.spyOn(fs, "readDirectory").mockImplementation(
				async (folder) => {
					if (
						folder === abs("vendor/kit") &&
						(await fs.exists(mirror()))
					)
						throw failure;
					return readDirectory(folder);
				}
			);
		};

		it("should fail when the folder can't be listed for its copy", async () => {
			const config = await mountingKit();
			listingFails(fileSystemError("EACCES", "permission denied"));

			expect(failureOf(await syncback(config)).message).toBe(
				"Syncback could not finish: permission denied. Run syncback again."
			);
		});

		it("should copy nothing of the folder when it is gone by the time it copies", async () => {
			const config = await mountingKit();
			listingFails(fileSystemError("ENOENT", "no such file"));
			let copied: string[] | undefined;
			rojo.say = async () => {
				copied = (
					await fs.readDirectory(mirror("ReplicatedStorage", "Kit"))
				).map(([name]) => name);
				return [];
			};

			expect((await syncback(config)).kind).toBe("planned");
			expect(copied).toEqual([]);
		});
	});

	describe("with an instance whose name Rojo can't write as files", () => {
		const root = ".rogen-syncback/mirror/ServerScriptService/Inventory";

		it.each([
			["..", [`${root}/../Escaped`, `${root}/../Escaped/Bag.luau`]],
			[".", [`${root}/./Bag.luau`]],
			["a backslash", [`${root}/a\\b/Bag.luau`]],
			["a slash", [`${root}/a/b`, `${root}/a/b/Bag.luau`]],
		])("should write nothing for a name with %s", async (_, files) => {
			const config = await prepared(["src/Inventory/Bag@Server.luau"]);
			rojo.say = async () => files.map((file) => `Writing ${file}`);

			const outcome = await syncback(config);

			expect(failureOf(outcome).message).toContain(
				files[0].replace(".rogen-syncback/mirror/", "")
			);
			expect(await fs.exists(abs("src/Inventory"))).toBe(true);
		});

		it.each(["rbxm", "rbxmx"])(
			"should write nothing when Rojo would write a folder of the project as a .%s model",
			async (extension) => {
				const config = await prepared([
					"src/Inventory/Bag@Server.luau",
				]);
				const model = `${root}.${extension}`;
				rojo.say = async () => [`Writing ${model}`];

				const outcome = await syncback(config);

				expect(failureOf(outcome).message).toContain(
					`ServerScriptService/Inventory.${extension}`
				);
			}
		);

		it("should let a model through that stands for the folder of a route", async () => {
			const config = await prepared([
				"src/Inventory/Bag@Server.luau",
				"src/Inventory/Types@Shared.luau",
			]);
			rojo.say = async () =>
				[".rogen-syncback/mirror/ReplicatedStorage/Shared.rbxm"].map(
					(file) => `Writing ${file}`
				);

			expect((await syncback(config)).kind).toBe("planned");
		});

		it("should let a model through that is not a folder of the project", async () => {
			const config = await prepared(["src/Inventory/Bag@Server.luau"]);
			rojo.say = async () => [`Writing ${root}/Gear.rbxm`];

			expect((await syncback(config)).kind).toBe("planned");
		});

		it("should let a path through that a project file's $path climbs out by", async () => {
			const config = await prepared(["src/Inventory/Bag@Server.luau"]);
			await writeFiles(fs, "vendor/Note.txt");
			rojo.say = async () => [
				`Writing ${root}/../../../../vendor/Note.txt`,
			];

			expect((await syncback(config)).kind).toBe("planned");
		});

		it("should run again for names whose folders Rojo writes too", async () => {
			const config = await prepared(["src/Inventory/Bag@Server.luau"]);
			rojo.say = async () => [
				`Writing ${root}/Pack`,
				`Writing ${root}/Pack/Bag.luau`,
			];

			expect((await syncback(config)).kind).toBe("planned");
		});
	});

	describe("with a YAML file Rojo stops on", () => {
		const refusing = (instance: string) =>
			new DiagnosticsError([
				{
					...errorDiagnostic(
						"rojo.commandFailed",
						{ resource: abs("rogen-syncback.project.json") },
						"Rojo couldn't sync back into this project:"
					),
					details: [
						`Failed to syncback ${instance} because cannot syncback Yaml middleware`,
					],
				},
			]);

		const mountingYaml = () =>
			prepared(["src/Combat/Server/Combat.luau"], {
				project: {
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Config: { $path: "vendor/Config.yaml" },
						},
					},
				},
			});

		beforeEach(async () => {
			await fs.writeFile(abs("vendor/Config.yaml"), "a: 1");
		});

		it.each([
			["the instance the tree mounts it at", "ReplicatedStorage/Config"],
			["only its name", "Workspace/Config"],
		])(
			"should leave out the file Rojo names by %s and run again",
			async (_, instance) => {
				const config = await mountingYaml();
				let runs = 0;
				rojo.say = async () => (runs++ === 0 ? refusing(instance) : []);

				const outcome = await syncback(config);

				expect(outcome).toMatchObject({
					kind: "planned",
					plan: {
						unplaced: [
							{
								instance,
								reason: expect.stringContaining("Yaml"),
							},
						],
					},
				});
				expect(runs).toBe(3);
			}
		);

		it("should fail with Rojo's error when no YAML file has the name Rojo gives", async () => {
			const config = await mountingYaml();
			const failure = refusing("Workspace/Other");
			rojo.say = async () => failure;

			expect(failureOf(await syncback(config)).message).toContain(
				"Rojo couldn't sync back"
			);
		});
	});
});
