import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { CodeFinder } from "../code-finder.js";

describe("CodeFinder.layoutOf", () => {
	const cwd = path.resolve("/mock/workspace");
	let fs: MemoryFileSystemService;

	const write = async (file: string, content = "") => {
		await fs.writeFile(path.join(cwd, file), content);
	};

	const layout = async () =>
		new CodeFinder(fs).layoutOf(
			cwd,
			await new CoreToolchainService(fs).detect(cwd)
		);

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

		it("should leave out places, whose folders are places rather than code", async () => {
			await write("src/Util.luau");
			await write("places/lobby/Game.server.lua");

			const found = await layout();

			expect(found.codeFolders).toEqual(["src"]);
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

	describe("places", () => {
		it("should list the folders in places, sorted", async () => {
			await write("places/match/Game.luau");
			await write("places/lobby/.gitkeep");
			await write("places/.hidden/x.luau");
			await write("places/notes.md");

			const found = await layout();

			expect(found.places).toEqual(["lobby", "match"]);
		});

		it("should find none without a places folder", async () => {
			expect((await layout()).places).toEqual([]);
		});
	});
});
