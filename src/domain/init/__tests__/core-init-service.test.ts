import { jest } from "@jest/globals";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import path from "path";
import { ResultError } from "../../../base/result.js";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	ACCEPT_DEFAULT,
	CANCEL,
	MockPromptService,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { PromptService } from "../../../platform/prompt/prompt-service.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { CoreInitService } from "../core-init-service.js";
import { InitPlan } from "../init-service.js";

const directory = path.resolve("/mock/my-game");

describe("CoreInitService", () => {
	let fileSystem: MemoryFileSystemService;

	beforeEach(async () => {
		fileSystem = new MemoryFileSystemService();
		await fileSystem.createDirectory(directory);
	});

	const serviceFor = (
		promptService: PromptService = new MockPromptService([], false),
		cwd = directory
	) => {
		const environmentService = new NativeEnvironmentService(
			{ _: ["init"] },
			cwd
		);
		return new CoreInitService(
			fileSystem,
			promptService,
			environmentService,
			new CoreToolchainService(fileSystem),
			new CoreConfigService(fileSystem, environmentService)
		);
	};

	const write = (file: string, content = "") =>
		fileSystem.writeFile(path.join(directory, file), content);

	describe("plan, before it asks", () => {
		it("should read the directory's toolchain", async () => {
			await write("tsconfig.json", "{}");

			const plan = (await serviceFor().plan([])).unwrap();

			expect(
				JSON.parse(plan?.files.at(-1)?.content ?? "{}").routes
			).toHaveProperty("server");
		});

		it("should write the config named on the command line", async () => {
			const plan = (await serviceFor().plan(["lobby"])).unwrap();

			expect(plan?.files.map(({ fileName }) => fileName)).toEqual([
				"lobby.rogen.json",
			]);
		});

		it("should refuse more than one name", async () => {
			const result = await serviceFor().plan(["a", "b"]);

			expect(result.isErr()).toBe(true);
		});

		it("should fail when the directory can't be read", async () => {
			const result = await serviceFor(
				undefined,
				path.join(directory, "missing")
			).plan([]);

			expect(result.isErr()).toBe(true);
		});
	});

	describe("plan", () => {
		it("should take every default when it can't ask", async () => {
			const plan = (await serviceFor().plan([])).unwrap();

			expect(plan?.files.map(({ fileName }) => fileName)).toEqual([
				"default.rogen.json",
			]);
			expect(plan?.nextSteps.run).toEqual([
				"rogen watch",
				"rojo serve default.project.json",
			]);
		});

		it("should resolve to nothing when the user cancels", async () => {
			const result = await serviceFor(
				new MockPromptService([CANCEL])
			).plan([]);

			expect(result.unwrap()).toBeUndefined();
		});

		it("should refuse to write over a config that exists", async () => {
			await write("default.rogen.json", "{}");

			const result = await serviceFor().plan([]);

			expect(result.isErr()).toBe(true);
		});

		it("should plan a place from the resolved default config", async () => {
			await write(
				"default.rogen.json",
				JSON.stringify({
					rootDirs: ["src"],
					routes: { "*": "ReplicatedStorage" },
				})
			);

			const plan = (
				await serviceFor(
					new MockPromptService(["place", "lobby", ""])
				).plan([])
			).unwrap();

			expect(plan?.files.map(({ fileName }) => fileName)).toEqual([
				"lobby.rogen.json",
			]);
			expect(JSON.parse(plan?.files[0].content ?? "{}").rootDirs).toEqual(
				["src", "places/lobby"]
			);
		});

		describe("beside an existing default.rogen.json", () => {
			const config = JSON.stringify({
				rootDirs: ["src"],
				routes: { "*": "ReplicatedStorage" },
			});

			const planWith = async (
				answers: ConstructorParameters<typeof MockPromptService>[0],
				names: readonly string[] = [],
				existing: readonly string[] = []
			) => {
				await write("default.rogen.json", config);
				for (const file of existing) await write(file);
				const prompts = new MockPromptService(answers);
				const result = await serviceFor(prompts).plan(names);
				return { prompts, result };
			};

			it("should ask what to add, preselecting a place", async () => {
				const { prompts, result } = await planWith([
					ACCEPT_DEFAULT,
					"arena",
					ACCEPT_DEFAULT,
				]);

				expect(prompts.asked[0]).toBe(
					"default.rogen.json exists. What do you want to add?"
				);
				expect(
					result.unwrap()?.files.map(({ fileName }) => fileName)
				).toEqual(["arena.rogen.json"]);
			});

			it("should add a place with its folder", async () => {
				const { result } = await planWith([
					ACCEPT_DEFAULT,
					"arena",
					ACCEPT_DEFAULT,
				]);

				expect(
					JSON.parse(result.unwrap()?.files[0].content ?? "{}")
				).toMatchObject({
					extends: "./default.rogen.json",
					rootDirs: ["src", "places/arena"],
				});
			});

			it("should reject a place folder inside default's root dirs", async () => {
				await expect(
					planWith([ACCEPT_DEFAULT, "arena", "src/arena"])
				).rejects.toThrow(
					"src/arena overlaps src, one of default's root dirs."
				);
			});

			it("should reject a place whose project file exists", async () => {
				await expect(
					planWith(
						[ACCEPT_DEFAULT, "arena"],
						[],
						["arena.project.json"]
					)
				).rejects.toThrow("arena.project.json already exists.");
			});

			it("should add a variant by name", async () => {
				const { prompts, result } = await planWith(["variant", "prod"]);

				expect(
					result.unwrap()?.files.map(({ fileName }) => fileName)
				).toEqual(["prod.rogen.json"]);
				expect(prompts.asked).toEqual([
					"default.rogen.json exists. What do you want to add?",
					"Variant name",
				]);
			});

			it("should reject a variant whose project file exists", async () => {
				await expect(
					planWith(["variant", "prod"], [], ["prod.project.json"])
				).rejects.toThrow("prod.project.json already exists.");
			});

			it("should ask every question again for a separate config", async () => {
				const { prompts, result } = await planWith([
					"separate",
					"test",
					...Array(6).fill(ACCEPT_DEFAULT),
				]);

				expect(
					result.unwrap()?.files.map(({ fileName }) => fileName)
				).toEqual(["test.rogen.json"]);
				expect(prompts.asked.slice(0, 3)).toEqual([
					"default.rogen.json exists. What do you want to add?",
					"Config name",
					"Language",
				]);
			});

			it("should fail at once when a given place name is taken", async () => {
				const { result } = await planWith(
					[ACCEPT_DEFAULT],
					["arena"],
					["arena.rogen.json"]
				);

				expect(
					result.isErr() &&
						result.error instanceof DiagnosticsError &&
						result.error.diagnostics
				).toMatchObject([{ code: "init.configExists" }]);
			});

			describe("when it can't ask", () => {
				const planNamed = async (
					names: readonly string[],
					defaultConfig = config
				) => {
					await write("default.rogen.json", defaultConfig);
					return serviceFor(new MockPromptService([], false)).plan(
						names
					);
				};

				it("should add the place named on the command line, as Enter would", async () => {
					const plan = (await planNamed(["lobby"])).unwrap();

					expect(plan?.files.map(({ fileName }) => fileName)).toEqual(
						["lobby.rogen.json"]
					);
					expect(
						JSON.parse(plan?.files[0].content ?? "{}")
					).toMatchObject({
						extends: "./default.rogen.json",
						rootDirs: ["src", "places/lobby"],
					});
				});

				it("should say how to add a place when none is named", async () => {
					const result = await planNamed([]);

					expect(
						result.isErr() &&
							result.error instanceof DiagnosticsError &&
							result.error.diagnostics
					).toMatchObject([
						{
							code: "init.configExists",
							resource: path.join(
								directory,
								"default.rogen.json"
							),
							message:
								"this config already exists. To add a place beside it, run 'rogen init <name>'.",
						},
					]);
				});

				it("should name a taken project file without asking to delete it", async () => {
					await write("lobby.project.json", "{}");

					const result = await planNamed(["lobby"]);

					expect(
						result.isErr() &&
							result.error instanceof DiagnosticsError &&
							result.error.diagnostics
					).toMatchObject([
						{
							code: "init.fileExists",
							resource: path.join(
								directory,
								"lobby.project.json"
							),
							message:
								"this file already exists, and init never overwrites one. Pick another name.",
						},
					]);
				});

				it("should fail rather than add a place folder inside default's root dirs", async () => {
					const result = await planNamed(
						["lobby"],
						JSON.stringify({
							rootDirs: ["places"],
							routes: { "*": "ReplicatedStorage" },
						})
					);

					expect(
						result.isErr() &&
							result.error instanceof DiagnosticsError &&
							result.error.diagnostics
					).toMatchObject([
						{
							code: "init.invalidPlaceFolder",
							resource: path.join(directory, "places/lobby"),
							message:
								"places/lobby overlaps places, one of default's root dirs. Pick a folder outside it.",
						},
					]);
				});
			});
		});

		it("should fail to plan a place when the default config is broken", async () => {
			await write("default.rogen.json", "{ not json");

			const result = await serviceFor(
				new MockPromptService(["place", "lobby", ""])
			).plan([]);

			expect(result.isErr()).toBe(true);
		});
	});

	describe("write", () => {
		const planned = async (): Promise<InitPlan> =>
			(await serviceFor().plan([])).unwrap() as InitPlan;

		it("should write the template, configs and compiler configs into the directory", async () => {
			await write("tsconfig.json", "{}");
			const plan = await planned();
			const names = plan.files.map(({ fileName }) => fileName);

			const result = await serviceFor().write(plan, () => undefined);

			expect(result.isOk()).toBe(true);
			expect(names).toContain("default.rogen.json");
			for (const name of names) {
				expect(
					await fileSystem.exists(path.join(directory, name))
				).toBe(true);
			}
		});

		it("should report each file as it is written", async () => {
			const onWritten = jest.fn<(fileName: string) => void>();

			await serviceFor().write(await planned(), onWritten);

			expect(onWritten).toHaveBeenCalledWith("default.rogen.json");
		});

		it("should stop at the file it can't write and name it", async () => {
			const onWritten = jest.fn<(fileName: string) => void>();
			jest.spyOn(fileSystem, "writeFile").mockRejectedValue(
				new Error("disk full")
			);

			const result = await serviceFor().write(await planned(), onWritten);

			expect((result as ResultError<Error>).error.message).toBe(
				"Failed to write default.rogen.json: disk full"
			);
			expect(onWritten).not.toHaveBeenCalled();
		});
	});
});
