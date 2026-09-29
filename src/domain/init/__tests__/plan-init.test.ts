import "../../config/config.js";
import "../../toolchain/luau.js";
import "../../toolchain/roblox-ts.js";
import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	CANCEL,
	MockPromptService,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { planInit, prepareInit } from "../plan-init.js";

const directory = path.resolve("/mock/my-game");

describe("plan-init", () => {
	let fileSystem: MemoryFileSystemService;

	beforeEach(async () => {
		fileSystem = new MemoryFileSystemService();
		await fileSystem.createDirectory(directory);
	});

	const write = (file: string, content = "") =>
		fileSystem.writeFile(path.join(directory, file), content);

	const prepared = async (names: readonly string[] = []) =>
		(await prepareInit(fileSystem, directory, names)).unwrap();

	describe("prepareInit", () => {
		it("should read the directory's entries and toolchain", async () => {
			await write("tsconfig.json", "{}");

			const request = await prepared();

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
			const result = await prepareInit(fileSystem, directory, ["a", "b"]);

			expect(result.isErr()).toBe(true);
		});

		it("should fail when the directory can't be read", async () => {
			const result = await prepareInit(
				fileSystem,
				path.join(directory, "missing"),
				[]
			);

			expect(result.isErr()).toBe(true);
		});
	});

	describe("planInit", () => {
		it("should take every default when it can't ask", async () => {
			const plan = (
				await planInit(
					fileSystem,
					new MockPromptService([], false),
					await prepared()
				)
			).unwrap();

			expect(plan?.configs.map(({ fileName }) => fileName)).toEqual([
				"default.rogen.json",
			]);
			expect(plan?.nextSteps.run).toEqual([
				"rogen watch",
				"rojo serve default.project.json",
			]);
		});

		it("should resolve to nothing when the user cancels", async () => {
			const result = await planInit(
				fileSystem,
				new MockPromptService([CANCEL]),
				await prepared()
			);

			expect(result.unwrap()).toBeUndefined();
		});

		it("should refuse to write over a config that exists", async () => {
			await write("default.rogen.json", "{}");

			const result = await planInit(
				fileSystem,
				new MockPromptService([], false),
				await prepared()
			);

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
				await planInit(
					fileSystem,
					new MockPromptService(["place", "lobby", ""]),
					await prepared()
				)
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

			const result = await planInit(
				fileSystem,
				new MockPromptService(["place", "lobby", ""]),
				await prepared()
			);

			expect(result.isErr()).toBe(true);
		});
	});
});
