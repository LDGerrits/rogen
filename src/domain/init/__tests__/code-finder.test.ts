import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { toolchainOf } from "../../toolchain/__tests__/toolchain-of.js";
import { codeFinderOf } from "./init-of.js";

describe("CodeFinder.layoutOf", () => {
	const cwd = path.resolve("/mock/workspace");
	let fs: MemoryFileSystemService;

	const write = async (file: string, content = "") => {
		await fs.writeFile(path.join(cwd, file), content);
	};

	const layout = async () =>
		codeFinderOf(fs).layoutOf(cwd, await toolchainOf(fs).detect(cwd));

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(cwd);
	});

	describe("code folders", () => {
		it("should list top-level folders holding code, sorted", async () => {
			await write("src/a/b/Deep.luau");
			await write("lib/Game.server.lua");
			await write("shared/Util.ts");
			await write("web/App.tsx");

			const found = await layout();

			expect(found.codeFolders).toEqual(["lib", "shared", "src", "web"]);
		});

		it("should skip folders without code, dot-folders and node_modules", async () => {
			await write("docs/readme.md");
			await write(".git/hooks/pre-commit.lua");
			await write("node_modules/pkg/index.ts");
			await write("src/nested/node_modules/x/y.lua");
			await write("src/Real.luau");

			const found = await layout();

			expect(found.codeFolders).toEqual(["src"]);
		});

		it("should skip package folders, include and the outDir", async () => {
			await write(
				"tsconfig.json",
				'{"compilerOptions":{"outDir":"lib"}}'
			);
			await write("Packages/Roact.luau");
			await write("include/RuntimeLib.lua");
			await write("lib/main.luau");
			await write("src/main.ts");

			const found = await layout();

			expect(found.codeFolders).toEqual(["src"]);
		});

		it("should leave out a src without code", async () => {
			await fs.createDirectory(path.join(cwd, "src"));

			expect((await layout()).codeFolders).toEqual([]);
		});
	});

	describe("Rojo's template layout", () => {
		it("should list the folders of the template that hold Luau", async () => {
			await write("src/server/init.server.luau");
			await write("src/shared/Hello.luau");

			expect((await layout()).templateFolders).toEqual([
				"src/shared",
				"src/server",
			]);
		});

		it("should list none where the code is roblox-ts, which compiles to its own layout", async () => {
			await write("src/server/main.server.ts");

			expect((await layout()).templateFolders).toEqual([]);
		});
	});

	describe("scripts at the root", () => {
		it("should list the scripts Rojo reads at the top of the folder", async () => {
			await write("Main.server.luau");
			await write("Util.lua");
			await write("vite.config.ts");
			await write("README.md");

			expect((await layout()).rootScripts).toEqual([
				"Main.server.luau",
				"Util.lua",
			]);
		});
	});

	describe("a folder that can't be read", () => {
		it("should have no code folders when the working directory is missing", async () => {
			const found = await codeFinderOf(fs).layoutOf(
				path.resolve("/nowhere"),
				await toolchainOf(fs).detect(cwd)
			);

			expect(found.codeFolders).toEqual([]);
		});

		it("should hold no code when it is missing", async () => {
			expect(
				await codeFinderOf(fs).holdsCode(path.join(cwd, "gone"))
			).toBe(false);
		});
	});
});
