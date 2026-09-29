import { DisposableStore } from "../../../base/disposable.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../config/config.js";
import { place } from "../pipeline.js";
import { metaNotSynced } from "../rules/meta-not-synced.js";
import {
	abs,
	configOf as baseConfigOf,
	indexOf,
	writeFiles,
} from "./fixtures.js";

const configOf = (overrides: Partial<ResolvedConfig> = {}): ResolvedConfig =>
	baseConfigOf({ syncDir: abs("dist"), ...overrides });

describe("metaNotSynced", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const write = (...paths: string[]) => writeFiles(fs, ...paths);

	const check = async (overrides: Partial<ResolvedConfig> = {}) => {
		const config = configOf(overrides);
		const index = await indexOf(store, fs, config.rootDirs);
		return metaNotSynced(place(index, config).unwrap(), fs);
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
				`2 meta files have no copy under "dist" (${abs("src/Inventory/Save.meta.json")}, ${abs("src/Inventory/init.meta.json")})`
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
