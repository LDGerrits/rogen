import { Darklua, LanguageId, PackageManager } from "../toolchain.js";
import { Luau } from "../luau.js";
import { workspaceOf } from "./workspaces.js";

describe("Darklua", () => {
	describe("SYNC_TOOL", () => {
		it("should say it turns .meta.json into .meta.lua", () => {
			expect(Darklua.SYNC_TOOL.metaReplacement).toEqual({
				suffix: ".meta.lua",
				note: "Darklua converts every .meta.json.",
			});
		});
	});
});

describe("PackageManager", () => {
	it("should land each installed folder where its packages are required from", () => {
		expect(
			PackageManager.WALLY.mounts(new Set(["Packages", "ServerPackages"]))
		).toEqual([
			{ path: "Packages", landing: "ReplicatedStorage/Packages" },
			{
				path: "ServerPackages",
				landing: "ServerScriptService/ServerPackages",
			},
		]);
		expect(
			PackageManager.PESDE.mounts(
				new Set(["roblox_packages", "roblox_server_packages"])
			).map(({ path }) => path)
		).toEqual(["roblox_packages", "roblox_server_packages"]);
	});

	it("should mount only the folders that are installed", () => {
		expect(
			PackageManager.WALLY.mounts(new Set(["Packages"])).map(
				({ path }) => path
			)
		).toEqual(["Packages"]);
		expect(PackageManager.WALLY.mounts(new Set())).toEqual([]);
	});

	it("should rank Pesde before Wally", () => {
		expect(PackageManager.PRIORITY).toEqual([
			PackageManager.PESDE,
			PackageManager.WALLY,
		]);
	});
});

describe("DetectedWorkspace", () => {
	it("should use the language that is present, else the first", () => {
		expect(workspaceOf().language.id).toBe("luau");
		expect(workspaceOf({ language: "roblox-ts" }).language.id).toBe(
			"roblox-ts"
		);
	});

	it("should find any language by id, whether or not it is present", () => {
		expect(workspaceOf().languageFor("roblox-ts").present).toBe(false);
	});

	it("should throw for a language it doesn't know", () => {
		expect(() => workspaceOf().languageFor("cobol" as LanguageId)).toThrow(
			"cobol"
		);
	});

	describe("packageMounts", () => {
		it("should mount the installed folders of the workspace's own manager", () => {
			const workspace = workspaceOf({
				packageManager: "pesde",
				packageDirs: ["roblox_packages", "Packages"],
			});

			expect(
				workspace
					.packageMounts(workspace.language)
					.map(({ path }) => path)
			).toEqual(["roblox_packages"]);
		});

		it("should mount the installed folders of the language's default manager when the workspace has none", () => {
			const workspace = workspaceOf({ packageDirs: ["Packages"] });

			expect(
				workspace.packageMounts(new Luau()).map(({ path }) => path)
			).toEqual(["Packages"]);
		});

		it("should mount nothing for a language with no manager and a workspace with none", () => {
			const workspace = workspaceOf();

			expect(
				workspace.packageMounts(workspace.languageFor("roblox-ts"))
			).toEqual([]);
		});
	});
});
