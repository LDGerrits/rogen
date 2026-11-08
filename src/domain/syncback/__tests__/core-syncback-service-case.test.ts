import { jest } from "@jest/globals";
import { ok } from "../../../base/result.js";

jest.unstable_mockModule("../../../base/platform.js", () => ({
	isWindows: false,
	ignoresPathCase: true,
}));

const { CoreIndexService } =
	await import("../../../platform/fs/core-index-service.js");
const { MemoryFileSystemService } =
	await import("../../../platform/fs/memory-file-system-service.js");
const { MockEnvironmentService } =
	await import("../../../platform/environment/__tests__/mock-environment-service.js");
const { MockProcessService } =
	await import("../../../platform/process/__tests__/mock-process-service.js");
const { MockLifecycleService } =
	await import("../../../platform/lifecycle/__tests__/mock-lifecycle-service.js");
const { abs, writeServiceOf, configOf, writeFiles } =
	await import("../../write/__tests__/fixtures.js");
const { MockConfigService, selectionOf } =
	await import("../../config/__tests__/mock-config-service.js");
const { CoreSyncbackService } = await import("../core-syncback-service.js");
const { ROUTES } = await import("./layout-fixtures.js");

describe("CoreSyncbackService where the file system ignores case", () => {
	it("should write a renamed file whose name only differs in case, though the old file answers for the new name", async () => {
		const fs = new MemoryFileSystemService();
		const oldFile = abs("src/Inventory/Bag@server.luau");
		const newFile = abs("src/Inventory/bag@server.luau");
		const mirror = (name: string) =>
			abs(".rogen-syncback/mirror/ServerScriptService/Inventory", name);
		await writeFiles(fs, "src/Inventory/Bag@server.luau");
		const config = configOf({ routes: ROUTES });
		const selection = selectionOf(config);
		const listedAt = ".rogen-syncback/mirror/ServerScriptService/Inventory";
		let runs = 0;
		const rojo = {
			choose: () => config,
			run: async () => {
				if (runs++ === 0) {
					await fs.delete(mirror("Bag.luau"));
					return ok({
						project: config,
						messages: [
							`Writing ${listedAt}/bag.luau`,
							`Removing ${listedAt}/Bag.luau`,
						].map((text) => ({ severity: "info", text })),
					});
				}
				await fs.writeFile(mirror("bag.luau"), "return 2");
				return ok({
					project: config,
					messages: [
						{
							severity: "info",
							text: `Writing ${listedAt}/bag.luau`,
						},
					],
				});
			},
		};
		const exists = fs.exists.bind(fs);
		fs.exists = async (file) =>
			(await exists(file)) ||
			(file === newFile && (await exists(oldFile)));
		const service = new CoreSyncbackService(
			new MockConfigService([]),
			fs,
			writeServiceOf(fs, new CoreIndexService(fs)),
			rojo as never,
			new MockEnvironmentService("/repo"),
			new MockProcessService(),
			new MockLifecycleService()
		);

		const { outcome } = await service.run(selection, {
			input: "game.rbxl",
			cwd: "/repo",
			mode: "apply",
		});

		expect(outcome).toMatchObject({
			kind: "written",
			plan: { unplaced: [] },
		});
		expect(runs).toBe(2);
		expect(await fs.readFile(newFile)).toBe("return 2");
	});
});
