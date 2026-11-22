import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { InstanceReference } from "../../roblox/roblox.js";
import { SyncRules } from "../../rojo/sync-rules.js";
import { MountedInstances } from "../locate/mounted-instances.js";
import { TreeMounts } from "../write-tree.js";
import { abs, absPosix, writeFiles } from "./fixtures.js";

describe("MountedInstances", () => {
	let fs: MemoryFileSystemService;

	const mounted = () =>
		new MountedInstances(
			fs,
			new TreeMounts(
				[
					{ path: abs("lib"), node: ["ReplicatedStorage", "Lib"] },
					{ path: abs("Map.rbxm"), node: ["Workspace", "Map"] },
				],
				abs("default.project.json")
			),
			SyncRules.DEFAULT
		);

	const sourcesAt = async (reference: string) =>
		(await mounted().filesAt(InstanceReference.parse(reference)!)).map(
			({ source }) => source
		);

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await writeFiles(
			fs,
			"lib/Net/Http.luau",
			"lib/Net/init.meta.json",
			"lib/Ui/Hud/Bar.luau",
			"Map.rbxm"
		);
	});

	describe("instanceOf", () => {
		it("should find no instance for a file no mount covers", async () => {
			expect(
				await mounted().instanceOf(absPosix("src/A.luau"))
			).toBeUndefined();
		});

		it("should take a folder's init meta for the folder", async () => {
			expect(
				await mounted().instanceOf(absPosix("lib/Net/init.meta.json"))
			).toEqual(["ReplicatedStorage", "Lib", "Net"]);
		});
	});

	describe("filesAt", () => {
		it("should name a mounted folder without an init script by the folder", async () => {
			expect(await sourcesAt("ReplicatedStorage.Lib")).toEqual([
				absPosix("lib"),
			]);
		});

		it("should name a mounted file by the file", async () => {
			expect(await sourcesAt("Workspace.Map")).toEqual([
				absPosix("Map.rbxm"),
			]);
		});

		it("should find nothing below a mounted file", async () => {
			expect(await sourcesAt("Workspace.Map.Tree")).toEqual([]);
		});

		it("should name a folder inside a mount without an init script by the folder", async () => {
			expect(await sourcesAt("ReplicatedStorage.Lib.Ui.Hud")).toEqual([
				absPosix("lib/Ui/Hud"),
			]);
		});

		it("should name a file inside a mount by its instance name", async () => {
			expect(await sourcesAt("ReplicatedStorage.Lib.Net.Http")).toEqual([
				absPosix("lib/Net/Http.luau"),
			]);
		});

		it("should find nothing below a folder the mount doesn't hold", async () => {
			expect(await sourcesAt("ReplicatedStorage.Lib.Gone.Http")).toEqual(
				[]
			);
		});
	});
});
