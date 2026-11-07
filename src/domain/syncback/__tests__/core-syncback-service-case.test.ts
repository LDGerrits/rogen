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
	it("should remove a renamed file's old file before it writes one whose name only differs in case", async () => {
		const fs = new MemoryFileSystemService();
		const mirror = (...instancePath: string[]) =>
			abs(".rogen-syncback/mirror", ...instancePath);
		const rojo = {
			run: async (_selection: unknown, request: { project: unknown }) => {
				await fs.delete(
					mirror("ServerScriptService", "Inventory", "Bag.luau")
				);
				await fs.writeFile(
					mirror("ServerScriptService", "Inventory", "bag.luau"),
					"return 2"
				);
				return ok({ project: request.project, messages: [] });
			},
		};
		await writeFiles(fs, "src/Inventory/Bag@server.luau");
		const config = configOf({ routes: ROUTES });
		const selection = selectionOf(config);
		await writeServiceOf(fs, new CoreIndexService(fs)).write(selection);
		const service = new CoreSyncbackService(
			new MockConfigService([]),
			fs,
			writeServiceOf(fs, new CoreIndexService(fs)),
			rojo as never,
			new MockEnvironmentService("/repo"),
			new MockProcessService(),
			new MockLifecycleService()
		);
		const calls: string[] = [];
		const write = fs.writeFileBytes.bind(fs);
		fs.writeFileBytes = async (file, bytes) => {
			if (file.includes("ag@server")) calls.push(`write ${file}`);
			return write(file, bytes);
		};
		const remove = fs.delete.bind(fs);
		fs.delete = async (file) => {
			if (file.includes("ag@server")) calls.push(`remove ${file}`);
			return remove(file);
		};

		(
			await service.apply({
				selection,
				project: config,
				input: "game.rbxl",
				cwd: "/repo",
			})
		).unwrap();

		expect(calls).toEqual([
			`remove ${abs("src/Inventory/Bag@server.luau")}`,
			`write ${abs("src/Inventory/bag@server.luau")}`,
		]);
	});
});
