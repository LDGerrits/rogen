import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { checkSyncMeta } from "../check-sync-meta.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

type Checked = Pick<
	ResolvedConfig,
	"rootDirs" | "exclude" | "syncDir" | "outFile"
>;

const configOf = (overrides: Partial<Checked> = {}): Checked => ({
	rootDirs: [abs("src")],
	exclude: [],
	syncDir: abs("dist"),
	outFile: abs("default.project.json"),
	...overrides,
});

describe("domain/output/check-sync-meta", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const write = async (...paths: string[]) => {
		for (const p of paths) await fs.writeFile(abs(p), "");
	};

	const check = async (overrides: Partial<Checked> = {}) => {
		const config = configOf(overrides);
		const index = store.add(new CoreIndexService(fs));
		await index.initialize([...config.rootDirs]);
		return checkSyncMeta(fs, index, config);
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("checkSyncMeta", () => {
		it("should report nothing without a syncDir", async () => {
			await write("src/Save.server.luau", "src/Save.meta.json");

			expect(await check({ syncDir: undefined })).toEqual([]);
		});

		it("should report nothing when every meta file was copied", async () => {
			await write(
				"src/Inventory/Save.server.ts",
				"src/Inventory/Save.meta.json",
				"src/Inventory/init.meta.json",
				"dist/Inventory/Save.server.luau",
				"dist/Inventory/Save.meta.json",
				"dist/Inventory/init.meta.json"
			);

			expect(await check()).toEqual([]);
		});

		it("should warn once for the meta files missing from the sync dir", async () => {
			await write(
				"src/Inventory/Save.server.luau",
				"src/Inventory/Save.meta.json",
				"src/Inventory/init.meta.json",
				"dist/Inventory/Save.server.luau"
			);

			const warnings = await check();

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toMatchObject({
				code: "output.metaNotSynced",
				resource: abs("default.project.json"),
			});
			expect(warnings[0].message).toContain(
				'2 meta files have no copy under "dist" (src/Inventory/Save.meta.json, src/Inventory/init.meta.json)'
			);
			expect(warnings[0].message).not.toContain(".meta.lua");
		});

		it("should say the processor converted a meta file it turned into .meta.lua", async () => {
			await write(
				"src/Inventory/Save.server.luau",
				"src/Inventory/Save.meta.json",
				"dist/Inventory/Save.server.luau",
				"dist/Inventory/Save.meta.lua"
			);

			const warnings = await check();

			expect(warnings).toHaveLength(1);
			expect(warnings[0].message).toContain(
				"The processor turned it into .meta.lua"
			);
		});

		it("should count only the meta files the processor converted", async () => {
			await write(
				"src/Inventory/Save.server.luau",
				"src/Inventory/Save.meta.json",
				"src/Inventory/init.meta.json",
				"dist/Inventory/Save.server.luau",
				"dist/Inventory/Save.meta.lua"
			);

			const warnings = await check();

			expect(warnings[0].message).toContain(
				"The processor turned 1 of them into .meta.lua"
			);
		});

		it("should leave out meta that no file claims", async () => {
			await write(
				"src/Inventory/Save.server.luau",
				"src/Inventory/Save.server.meta.json",
				"dist/Inventory/Save.server.luau"
			);

			expect(await check()).toEqual([]);
		});

		it("should skip a root dir with no output under the sync dir", async () => {
			await write(
				"src/Inventory/Save.server.luau",
				"src/Inventory/Save.meta.json"
			);

			expect(await check()).toEqual([]);
		});

		it("should leave out excluded meta files", async () => {
			await write(
				"src/Inventory/Save.server.luau",
				"src/Inventory/Save.meta.json",
				"dist/Inventory/Save.server.luau"
			);

			expect(
				await check({ exclude: [abs("src/Inventory/Save.meta.json")] })
			).toEqual([]);
		});
	});
});
