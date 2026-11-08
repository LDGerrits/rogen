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
	it("should remove a renamed file's old file before it writes one whose name only differs in case", async () => {
		const fs = new MemoryFileSystemService();
		const old = abs("src/Inventory/Bag@server.luau");
		const fresh = abs("src/Inventory/bag@server.luau");
		await fs.writeFile(old, "");
		const config = configOf();
		const calls: string[] = [];
		const writeBytes = fs.writeFileBytes.bind(fs);
		fs.writeFileBytes = async (file, content) => {
			calls.push(`write ${file}`);
			return writeBytes(file, content);
		};
		const deleted = fs.delete.bind(fs);
		fs.delete = async (file) => {
			calls.push(`remove ${file}`);
			return deleted(file);
		};

		await new PlanWriter(
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

		expect(calls).toEqual([`remove ${old}`, `write ${fresh}`]);
	});
});
