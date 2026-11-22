import { jest } from "@jest/globals";
import { ok } from "../../../base/result.js";

jest.unstable_mockModule("../../../base/platform.js", () => ({
	isWindows: false,
	ignoresPathCase: true,
}));

const { DiagnosticsError } =
	await import("../../../platform/diagnostics/diagnostics-error.js");
const { errorDiagnostic } =
	await import("../../../platform/diagnostics/diagnostic.js");
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
const { syncbackServiceOf } = await import("./syncback-of.js");
const { ROUTES } = await import("./layout-fixtures.js");

describe("MirrorWorkspace where the file system ignores case", () => {
	it("should fail when Rojo fails as it writes again the file it lost to a rename in letter case", async () => {
		const fs = new MemoryFileSystemService();
		await writeFiles(fs, "src/Inventory/Bag@Server.luau");
		const config = configOf({ routes: ROUTES });
		const listedAt = ".rogen-syncback/mirror/ServerScriptService/Inventory";
		const failure = new DiagnosticsError([
			errorDiagnostic("rojo.failed", { resource: "/repo" }, "no"),
		]);
		let runs = 0;
		const rojo = {
			choose: () => config,
			run: async () =>
				ok(
					runs++ === 0
						? {
								project: config,
								messages: [
									`Writing ${listedAt}/bag.luau`,
									`Removing ${listedAt}/Bag.luau`,
								].map((text) => ({
									severity: "unrecognised",
									text,
								})),
							}
						: { project: config, messages: [], failure }
				),
		};
		const service = syncbackServiceOf({
			configService: new MockConfigService([]),
			fileSystemService: fs,
			writeService: writeServiceOf(fs, new CoreIndexService(fs)),
			rojoService: rojo as never,
			environmentService: new MockEnvironmentService("/repo"),
			processService: new MockProcessService(),
			lifecycleService: new MockLifecycleService(),
		});

		const { outcome } = await service.run(selectionOf(config), {
			input: "game.rbxl",
			cwd: "/repo",
			mode: "apply",
		});

		expect(outcome).toMatchObject({ kind: "failed", error: failure });
		expect(runs).toBe(2);
		expect(await fs.readFile(abs("src/Inventory/Bag@Server.luau"))).toBe(
			""
		);
	});
});
