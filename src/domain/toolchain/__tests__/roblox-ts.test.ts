import { RobloxTs, RobloxTsCompiler } from "../roblox-ts.js";

const robloxTsSyncTool = new RobloxTsCompiler();

describe("roblox-ts sync tool", () => {
	it.each(["Foo.ts", "Foo.server.tsx", "src/Foo.TS"])(
		"should write %s as Luau",
		(file) => {
			expect(robloxTsSyncTool.emittedPath?.(file)).toMatch(/\.luau$/);
		}
	);

	it("should leave a Luau file's path alone", () => {
		expect(robloxTsSyncTool.emittedPath?.("src/Foo.luau")).toBe(
			"src/Foo.luau"
		);
	});

	it("should only read declaration files", () => {
		expect(robloxTsSyncTool.readsOnly?.("types/Foo.d.ts")).toBe(true);
		expect(robloxTsSyncTool.readsOnly?.("Foo.ts")).toBe(false);
	});
});

describe("RobloxTs", () => {
	it("should keep route keys as written", () => {
		expect(new RobloxTs({}, true).routeKey("serverStorage")).toBe(
			"serverStorage"
		);
	});

	it("should compile to the outDir tsconfig.json names, else out", () => {
		expect(new RobloxTs({ outDir: "build" }, true).compiler.outDir).toBe(
			"build"
		);
		expect(new RobloxTs({}, true).compiler.outDir).toBe("out");
	});

	it("should leave the folder it compiles into to the compiler, and include to itself", () => {
		expect(
			new RobloxTs({ outDir: "build/game" }, true).reservedFolders
		).toEqual(["include", "build"]);
		expect(new RobloxTs({}, false).reservedFolders).toEqual(["include"]);
	});

	it("should offer the root dir tsconfig.json names, without a leading ./", () => {
		expect(
			new RobloxTs({ rootDir: "./game/" }, true).configuredRootDir()
		).toBe("game");
	});
});
