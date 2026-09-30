import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { ConfigSet, sourceStemOf } from "../config-set.js";

const toolchain = new CoreToolchainService(new MemoryFileSystemService());
const luau = toolchain.getLanguage("luau");
const robloxTs = toolchain.getLanguage("roblox-ts");

describe("sourceStemOf", () => {
	it("should call default's source config source", () => {
		expect(sourceStemOf("default")).toBe("source");
	});

	it("should suffix any other name", () => {
		expect(sourceStemOf("lobby")).toBe("lobby-source");
	});
});

describe("ConfigSet", () => {
	describe("without a processor", () => {
		const set = new ConfigSet("default", luau, false);

		it("should write one config, edited in place", () => {
			expect(set.sourced).toBe(false);
			expect(set.sourceFile).toBeUndefined();
			expect(set.configFiles).toEqual(["default.rogen.json"]);
			expect(set.editedFile).toBe("default.rogen.json");
			expect(set.stems).toEqual(["default"]);
		});

		it("should write one project file", () => {
			expect(set.outputFiles).toEqual(["default.project.json"]);
		});
	});

	describe("with Darklua reading the root dirs", () => {
		const set = new ConfigSet("game", luau, true);

		it("should write a source config first, then the synced one", () => {
			expect(set.sourced).toBe(true);
			expect(set.sourceFile).toBe("game-source.rogen.json");
			expect(set.configFiles).toEqual([
				"game-source.rogen.json",
				"game.rogen.json",
			]);
		});

		it("should edit the source config, since it holds the root dirs", () => {
			expect(set.editedFile).toBe("game-source.rogen.json");
		});

		it("should list the synced project first", () => {
			expect(set.stems).toEqual(["game", "game-source"]);
			expect(set.outputFiles).toEqual([
				"game.project.json",
				"game-source.project.json",
			]);
		});
	});

	describe("with a compiler", () => {
		it("should write one config even when Darklua reads the compiler's output", () => {
			const set = new ConfigSet("default", robloxTs, true);

			expect(set.sourced).toBe(false);
			expect(set.configFiles).toEqual(["default.rogen.json"]);
		});
	});

	describe("placeFiles", () => {
		it("should be the place's config and project file", () => {
			expect(new ConfigSet("lobby", luau, false).placeFiles).toEqual([
				"lobby.rogen.json",
				"lobby.project.json",
			]);
		});

		it("should add the source config of a sourced place", () => {
			expect(new ConfigSet("lobby", luau, true).placeFiles).toEqual([
				"lobby.rogen.json",
				"lobby-source.rogen.json",
				"lobby.project.json",
			]);
		});

		it("should add the compiler's own per-place files", () => {
			expect(new ConfigSet("lobby", robloxTs, false).placeFiles).toEqual([
				"lobby.rogen.json",
				"tsconfig.lobby.json",
				"lobby.project.json",
			]);
		});
	});
});
