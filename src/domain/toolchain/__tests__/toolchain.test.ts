import path from "path";
import { Darklua, DetectedWorkspace, PackageManager } from "../toolchain.js";
import { Luau } from "../luau.js";
import { workspaceOf } from "./workspaces.js";

const directory = path.resolve("/mock/my-game");

const darklua = new Darklua();

describe("Darklua", () => {
	describe("processCommands", () => {
		it("should process one root dir into the sync dir itself", () => {
			expect(darklua.processCommands(directory, ["src"], "dist")).toEqual(
				["darklua process src dist"]
			);
		});

		it("should process each of several root dirs to its path under the common root", () => {
			expect(
				darklua.processCommands(
					directory,
					["src", "places/lobby"],
					"dist/lobby"
				)
			).toEqual([
				"darklua process src dist/lobby/src",
				"darklua process places/lobby dist/lobby/places/lobby",
			]);
		});

		it("should measure from the deepest shared folder", () => {
			expect(
				darklua.processCommands(
					directory,
					["game/src", "game/lib"],
					"dist"
				)
			).toEqual([
				"darklua process game/src dist/src",
				"darklua process game/lib dist/lib",
			]);
		});
	});

	describe("metaReplacement", () => {
		it("should say it turns .meta.json into .meta.lua", () => {
			expect(darklua.metaReplacement).toEqual({
				suffix: ".meta.lua",
				note: "Darklua converts every .meta.json this way.",
			});
		});
	});
});

describe("PackageManager", () => {
	const none = new Set<string>();

	it("should offer its shared and server folders", () => {
		expect(
			PackageManager.WALLY.mounts(none, false).map(({ path }) => path)
		).toEqual(["Packages", "ServerPackages"]);
		expect(
			PackageManager.PESDE.mounts(none, false).map(({ path }) => path)
		).toEqual(["roblox_packages", "roblox_server_packages"]);
	});

	it("should land each folder where the manager's packages are required from", () => {
		expect(
			PackageManager.WALLY.mounts(none, false).map(
				({ landing }) => landing
			)
		).toEqual([
			"ReplicatedStorage/Packages",
			"ServerScriptService/ServerPackages",
		]);
	});

	it("should start a folder ticked when it is installed or a manifest promises it", () => {
		const installed = new Set(["Packages"]);

		expect(
			PackageManager.WALLY.mounts(installed, false).map(
				({ installed, ticked }) => ({ installed, ticked })
			)
		).toEqual([
			{ installed: true, ticked: true },
			{ installed: false, ticked: false },
		]);
		expect(
			PackageManager.WALLY.mounts(none, true).map(({ ticked }) => ticked)
		).toEqual([true, true]);
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
		expect(() => workspaceOf().languageFor("cobol")).toThrow("cobol");
	});

	it("should need a language", () => {
		expect(
			() =>
				new DetectedWorkspace({
					languages: [],
					usesDarklua: false,
					packageDirs: new Set(),
					codeFolders: [],
					hasSrc: false,
					places: [],
				})
		).toThrow("at least one language");
	});

	describe("packageMounts", () => {
		it("should offer the workspace's own manager, ticked", () => {
			const workspace = workspaceOf({
				packageManager: "pesde",
				packageDirs: ["roblox_packages"],
			});

			expect(
				workspace
					.packageMounts(workspace.language)
					.map(({ path, ticked }) => [path, ticked])
			).toEqual([
				["roblox_packages", true],
				["roblox_server_packages", true],
			]);
		});

		it("should offer the language's default manager, unticked, when the workspace has none", () => {
			const workspace = workspaceOf();

			expect(
				workspace
					.packageMounts(new Luau())
					.map(({ path, ticked }) => [path, ticked])
			).toEqual([
				["Packages", false],
				["ServerPackages", false],
			]);
		});

		it("should offer nothing for a language with no manager and a workspace with none", () => {
			const workspace = workspaceOf();

			expect(
				workspace.packageMounts(workspace.languageFor("roblox-ts"))
			).toEqual([]);
		});
	});
});
