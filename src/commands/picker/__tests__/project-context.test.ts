import path from "path";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { NativeEnvironmentService } from "../../../platform/environment/native-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProductService } from "../../../platform/product/__tests__/mock-product-service.js";
import { ProjectContext } from "../project-context.js";

describe("ProjectContext", () => {
	const root = path.resolve("/mock/my-game");
	let fileSystem: MemoryFileSystemService;

	beforeEach(async () => {
		fileSystem = new MemoryFileSystemService();
		await fileSystem.createDirectory(root);
	});

	const write = (file: string, content = "") =>
		fileSystem.writeFile(path.join(root, file), content);

	const contextAt = (cwd = root) =>
		new ProjectContext(
			new CoreConfigService(
				fileSystem,
				new NativeEnvironmentService({}, cwd)
			),
			fileSystem,
			new MockProductService("2.0.1"),
			cwd
		);

	describe("describe", () => {
		it("should name the version and the project of the config here", async () => {
			await write("rogen.json", '{"name":"Cool Game"}');

			expect(await contextAt().describe()).toEqual({
				version: "2.0.1",
				name: "Cool Game",
			});
		});

		it("should name the folder when the config sets no name", async () => {
			await write("rogen.json", "{}");

			expect((await contextAt().describe()).name).toBe("my-game");
		});

		it("should find the config above the folder", async () => {
			await write("rogen.json", "{}");
			await fileSystem.createDirectory(path.join(root, "src"));

			expect(
				(await contextAt(path.join(root, "src")).describe()).name
			).toBe("my-game");
		});

		it("should have no name where no config is", async () => {
			expect(await contextAt().describe()).toEqual({
				version: "2.0.1",
				name: undefined,
			});
		});

		it("should still name the folder of a config that is broken", async () => {
			await write("rogen.json", "{ nope");

			expect((await contextAt().describe()).name).toBe("my-game");
		});
	});

	describe("files", () => {
		const extensions = [".rbxl", ".rbxlx", ".rbxm", ".rbxmx"];

		it("should find the files with those extensions, as paths from here", async () => {
			await write("game.rbxl");
			await write("places/lobby.rbxlx");
			await write("README.md");

			expect(await contextAt().files(extensions)).toEqual([
				"game.rbxl",
				"places/lobby.rbxlx",
			]);
		});

		it("should match the extension in any case", async () => {
			await write("GAME.RBXL");

			expect(await contextAt().files(extensions)).toEqual(["GAME.RBXL"]);
		});

		it("should skip node_modules and hidden folders", async () => {
			await write("node_modules/pkg/a.rbxm");
			await write(".git/b.rbxm");
			await write("models/c.rbxm");

			expect(await contextAt().files(extensions)).toEqual([
				"models/c.rbxm",
			]);
		});

		it("should look no deeper than three folders", async () => {
			await write("a/b/c/near.rbxm");
			await write("a/b/c/d/far.rbxm");

			expect(await contextAt().files(extensions)).toEqual([
				"a/b/c/near.rbxm",
			]);
		});

		it("should stop at twenty files", async () => {
			for (let at = 0; at < 30; at++) await write(`m${at}.rbxm`);

			expect(await contextAt().files(extensions)).toHaveLength(20);
		});

		it("should find none in a folder with none", async () => {
			expect(await contextAt().files(extensions)).toEqual([]);
		});
	});
});
