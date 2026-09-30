import { Luau } from "../luau.js";
import { Language, PackageManager } from "../toolchain.js";

describe("Luau", () => {
	const luau: Language & Luau = new Luau();

	it("should capitalize route keys", () => {
		expect(luau.routeKey("serverStorage")).toBe("ServerStorage");
	});

	it("should offer Wally when the workspace has no package manager", () => {
		expect(luau.defaultPackageManager).toBe(PackageManager.WALLY);
	});

	it("should have nothing to compile, mount or reserve", () => {
		expect(luau.compiler).toBeUndefined();
		expect(luau.alwaysMounted()).toEqual([]);
		expect(luau.offeredMounts()).toEqual([]);
		expect(luau.reservedFolders).toEqual([]);
		expect(luau.configuredRootDir()).toBeUndefined();
	});

	it("should never claim the workspace, since it leaves nothing of its own", async () => {
		expect((await luau.detect()).present).toBe(false);
	});
});
