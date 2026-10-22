import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { PlaceLayouts } from "../place-layout.js";

const root = path.resolve("/mock/game-repo");

describe("PlaceLayouts", () => {
	let fileSystem: MemoryFileSystemService;

	const place = (...sourcePaths: string[]) =>
		JSON.stringify({ rogen: { sourcePaths } });

	const put = (file: string, content = "") =>
		fileSystem.writeFile(path.join(root, file), content);

	const find = (target: string, cwd = root) =>
		new PlaceLayouts(fileSystem).find(cwd, path.resolve(cwd, target));

	beforeEach(async () => {
		fileSystem = new MemoryFileSystemService();
		await fileSystem.createDirectory(root);
	});

	describe("at the root", () => {
		beforeEach(async () => {
			await put("src/common/Util.luau");
			await put("game.rogen.json", place("src/common", "src/game"));
		});

		it("should find a new name directly below the root", async () => {
			const layout = await find("lobby");

			expect(layout).toMatchObject({
				root,
				name: "lobby",
				place: "lobby",
				folder: "",
				source: "src/lobby",
				sourcePaths: ["src/common", "src/lobby"],
				seeded: true,
			});
			expect(layout?.configFile()).toBe("lobby.rogen.json");
			expect(layout?.configFile("dist")).toBe("lobby.dist.rogen.json");
			expect(layout?.model.file).toBe(path.join(root, "game.rogen.json"));
		});

		it("should read a ./ and a trailing slash as the same name", async () => {
			expect(await find("./lobby/")).toMatchObject({ name: "lobby" });
		});

		it("should read the source paths as the config writes them", async () => {
			await fileSystem.delete(path.join(root, "game.rogen.json"));
			await put("game.rogen.json", place("./src/common/", "src/game"));

			expect(await find("lobby")).toBeDefined();
		});

		it("should start a project for a path that is not directly below the root", async () => {
			expect(await find("somewhere/else")).toBeUndefined();
			expect(await find("src/lobby")).toBeUndefined();
		});

		it("should start a project below a folder other than the root", async () => {
			await fileSystem.createDirectory(path.join(root, "tools"));

			expect(
				await find("lobby", path.join(root, "tools"))
			).toBeUndefined();
		});

		it("should start a project in a folder that exists", async () => {
			await fileSystem.createDirectory(path.join(root, "lobby"));

			expect(await find("lobby")).toBeUndefined();
		});

		it("should need src/common", async () => {
			await fileSystem.delete(path.join(root, "src/common"), true);

			expect(await find("lobby")).toBeUndefined();
		});

		it("should need a config that lists src/common", async () => {
			await fileSystem.delete(path.join(root, "game.rogen.json"));
			await put("game.rogen.json", place("src/game"));
			await put("broken.rogen.json", "{ broken");

			expect(await find("lobby")).toBeUndefined();
		});

		it("should not take a default config for a place", async () => {
			await fileSystem.delete(path.join(root, "game.rogen.json"));
			await put("default.rogen.json", place("src/common"));

			expect(await find("lobby")).toBeUndefined();
		});

		it("should copy a place and not its dist or release config", async () => {
			await put("game.dist.rogen.json", place("src/common", "src/game"));
			await put(
				"game.release.rogen.json",
				place("src/common", "src/game")
			);

			const layout = await find("lobby");

			expect(layout?.model.file).toBe(path.join(root, "game.rogen.json"));
			expect(await layout?.model.output("dist")).toBeDefined();
			expect(await layout?.model.output("release")).toBeDefined();
		});

		it("should refuse a name that can't name a place", async () => {
			await expect(find("my.lobby")).rejects.toThrow(
				"can't name a place"
			);
			await expect(find("default")).rejects.toThrow("can't name a place");
		});
	});

	describe("in projects", () => {
		beforeEach(async () => {
			await put("projects/game/default.rogen.json", place("src"));
			await put("projects/common/src/Util.ts");
		});

		it("should find a new folder of projects", async () => {
			const layout = await find("projects/lobby");

			expect(layout).toMatchObject({
				root,
				name: "lobby",
				place: "projects/lobby",
				folder: "projects/lobby",
				source: "projects/lobby/src",
				sourcePaths: ["../common/src", "src"],
				seeded: false,
			});
			expect(layout?.configFile()).toBe(
				"projects/lobby/default.rogen.json"
			);
			expect(layout?.configFile("dist")).toBe(
				"projects/lobby/dist.rogen.json"
			);
		});

		it("should start a project in a folder that has a config", async () => {
			await put("projects/lobby/default.rogen.json", "{}");

			expect(await find("projects/lobby")).toBeUndefined();
		});
	});
});
