import { jest } from "@jest/globals";
import "../../config/config.js";
import "../../toolchain/luau.js";
import "../../toolchain/roblox-ts.js";
import path from "path";
import { ResultError } from "../../../base/result.js";
import { NativeEnvironmentService } from "../../../platform/environment/environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	CANCEL,
	MockPromptService,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { PromptService } from "../../../platform/prompt/prompt-service.js";
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
	) =>
		new CoreInitService(
			fileSystem,
			promptService,
			new NativeEnvironmentService({ _: ["init"] }, cwd)
		);

	const write = (file: string, content = "") =>
		fileSystem.writeFile(path.join(directory, file), content);

	const prepared = async (names: readonly string[] = []) =>
		(await serviceFor().prepare(names)).unwrap();

	describe("prepare", () => {
		it("should read the directory's entries and toolchain", async () => {
			await write("tsconfig.json", "{}");

			const request = await prepared();

			expect(request.directory).toBe(directory);
			expect(request.existingFiles).toEqual(new Set(["tsconfig.json"]));
			expect(request.workspace.language).toBe("roblox-ts");
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

			expect(plan?.configs.map(({ fileName }) => fileName)).toEqual([
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

			expect(plan?.configs.map(({ fileName }) => fileName)).toEqual([
				"lobby.rogen.json",
			]);
			expect(
				JSON.parse(plan?.configs[0].content ?? "{}").rootDirs
			).toEqual(["src", "places/lobby"]);
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
			const names = [
				...(plan.template ? [plan.template] : []),
				...plan.configs,
				...plan.compilerConfigs,
			].map(({ fileName }) => fileName);

			const result = await serviceFor().write(
				await prepared(),
				plan,
				() => undefined
			);

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

			await serviceFor().write(
				await prepared(),
				await planned(),
				onWritten
			);

			expect(onWritten).toHaveBeenCalledWith("default.rogen.json");
		});

		it("should stop at the file it can't write and name it", async () => {
			const onWritten = jest.fn<(fileName: string) => void>();
			jest.spyOn(fileSystem, "writeFile").mockRejectedValue(
				new Error("disk full")
			);

			const result = await serviceFor().write(
				await prepared(),
				await planned(),
				onWritten
			);

			expect((result as ResultError<Error>).error.message).toBe(
				"Failed to write default.rogen.json: disk full"
			);
			expect(onWritten).not.toHaveBeenCalled();
		});
	});
});
