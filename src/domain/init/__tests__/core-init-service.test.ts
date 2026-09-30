import { jest } from "@jest/globals";
import "../../config/config-schema.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import path from "path";
import { ResultError } from "../../../base/result.js";
import { NativeEnvironmentService } from "../../../platform/environment/environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	ACCEPT_DEFAULT,
	CANCEL,
	MockPromptService,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
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

	const prepared = async (names: readonly string[] = []) =>
		(await serviceFor().prepare(names)).unwrap();

	describe("prepare", () => {
		it("should read the directory's entries and toolchain", async () => {
			await write("tsconfig.json", "{}");

			const request = await prepared();

			expect(request.path).toBe(directory);
			expect(request.has("tsconfig.json")).toBe(true);
			expect(request.has("src")).toBe(false);
			expect(request.workspace.language.id).toBe("roblox-ts");
			expect(request.name).toBe("default");
			expect(request.givenName).toBeUndefined();
		});

		it("should keep a name given on the command line", async () => {
			const request = await prepared(["lobby"]);

			expect(request.givenName).toBe("lobby");
			expect(request.name).toBe("lobby");
		});

		it("should refuse more than one name", async () => {
			const result = await serviceFor().prepare(["a", "b"]);

			expect(result.isErr()).toBe(true);
		});

		it("should fail when the directory can't be read", async () => {
			const result = await serviceFor(
				undefined,
				path.join(directory, "missing")
			).prepare([]);

			expect(result.isErr()).toBe(true);
		});
	});

	describe("plan", () => {
		it("should take every default when it can't ask", async () => {
			const plan = (await serviceFor().plan(await prepared())).unwrap();

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
			).plan(await prepared());

			expect(result.unwrap()).toBeUndefined();
		});

		it("should refuse to write over a config that exists", async () => {
			await write("default.rogen.json", "{}");

			const result = await serviceFor().plan(await prepared());

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
				).plan(await prepared())
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
				const result = await serviceFor(prompts).plan(
					await prepared(names)
				);
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
					result.isErr() && result.error.diagnostics
				).toMatchObject([{ code: "init.configExists" }]);
			});

			it("should add a separate config named on the command line when it can't ask", async () => {
				await write("default.rogen.json", config);

				const plan = (
					await serviceFor(new MockPromptService([], false)).plan(
						await prepared(["lobby"])
					)
				).unwrap();

				expect(plan?.files.map(({ fileName }) => fileName)).toEqual([
					"lobby.rogen.json",
				]);
				expect(
					JSON.parse(plan?.files[0].content ?? "{}").extends
				).toBeUndefined();
			});
		});

		it("should fail to plan a place when the default config is broken", async () => {
			await write("default.rogen.json", "{ not json");

			const result = await serviceFor(
				new MockPromptService(["place", "lobby", ""])
			).plan(await prepared());

			expect(result.isErr()).toBe(true);
		});
	});

	describe("write", () => {
		const planned = async (): Promise<InitPlan> =>
			(await serviceFor().plan(await prepared())).unwrap() as InitPlan;

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
