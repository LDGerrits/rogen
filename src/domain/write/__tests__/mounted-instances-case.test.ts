import { jest } from "@jest/globals";

jest.unstable_mockModule("../../../base/platform.js", () => ({
	isWindows: false,
	ignoresPathCase: true,
}));

const { MemoryFileSystemService } =
	await import("../../../platform/fs/memory-file-system-service.js");
const { SyncRules } = await import("../../rojo/sync-rules.js");
const { MountedInstances } = await import("../locate/mounted-instances.js");
const { TreeMounts } = await import("../write-tree.js");
const { abs, absPosix } = await import("./fixtures.js");

describe("MountedInstances where the file system ignores case", () => {
	it("should find no instance for a file whose path spells the mount in another case", async () => {
		const mounted = new MountedInstances(
			new MemoryFileSystemService(),
			new TreeMounts(
				[{ path: abs("lib"), node: ["ReplicatedStorage", "Lib"] }],
				abs("default.project.json")
			),
			SyncRules.DEFAULT
		);

		expect(
			await mounted.instanceOf(absPosix("Lib/Net/Http.luau"))
		).toBeUndefined();
	});
});
