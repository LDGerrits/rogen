import { robloxTsSyncTool } from "../roblox-ts.js";

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
