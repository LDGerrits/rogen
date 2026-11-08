import { jest } from "@jest/globals";

jest.unstable_mockModule("../../../base/platform.js", () => ({
	isWindows: false,
	ignoresPathCase: true,
}));

const { CoreIndexService } =
	await import("../../../platform/fs/core-index-service.js");
const { MemoryFileSystemService } =
	await import("../../../platform/fs/memory-file-system-service.js");
const { selectionOf } =
	await import("../../config/__tests__/mock-config-service.js");
const { abs, configOf, writeServiceOf } =
	await import("../../write/__tests__/fixtures.js");
const { MirrorPlan } = await import("../mirror-plan.js");
const { PlanWriter } = await import("../plan-writer.js");

describe("PlanWriter where the file system ignores case", () => {
	const old = abs("src/Inventory/Bag@server.luau");
	const fresh = abs("src/Inventory/bag@server.luau");

	const writeRename = (fs: InstanceType<typeof MemoryFileSystemService>) => {
		const config = configOf();
		return new PlanWriter(
			fs,
			writeServiceOf(fs, new CoreIndexService(fs))
		).write(
			{
				selection: selectionOf(config),
				project: config,
				input: "game.rbxl",
				cwd: "/repo",
			},
			new MirrorPlan(
				config,
				[],
				[],
				[
					{
						kind: "write",
						file: fresh,
						instance: "Bag",
						bytes: new TextEncoder().encode("return 2"),
					},
					{ kind: "remove", file: old, instance: "Bag" },
				],
				new Map(),
				[],
				[]
			)
		);
	};

	it("should give a renamed file the name that only differs in case, then write it", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile(old, "return 1");

		await writeRename(fs);

		expect(await fs.exists(old)).toBe(false);
		expect(await fs.readFile(fresh)).toBe("return 2");
	});

	it("should keep what a renamed file held when its new content can't be written", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile(old, "return 1");
		fs.writeFileBytes = async () => {
			throw new Error("disk full");
		};

		const result = await writeRename(fs);

		expect(await fs.readFile(fresh)).toBe("return 1");
		expect(result.unplaced).toMatchObject([
			{ reason: expect.stringContaining("disk full") },
		]);
	});
});
