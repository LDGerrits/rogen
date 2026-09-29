import { DisposableStore } from "../../../../../base/disposable.js";
import { MemoryFileSystemService } from "../../../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../../../config/config.js";
import { SyncTool } from "../../../../toolchain/toolchain.js";
import { place } from "../../../pipeline/pipeline.js";
import { metaNotSynced } from "../meta-not-synced.js";
import {
	abs,
	configOf as baseConfigOf,
	indexOf,
	syncTools,
	writeFiles,
} from "../../../__tests__/fixtures.js";

const configOf = (overrides: Partial<ResolvedConfig> = {}): ResolvedConfig =>
	baseConfigOf({ syncDir: abs("dist"), ...overrides });

describe("metaNotSynced", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const write = (...paths: string[]) => writeFiles(fs, ...paths);

	const check = async (
		overrides: Partial<ResolvedConfig> = {},
		tools: readonly SyncTool[] = syncTools
	) => {
		const config = configOf(overrides);
		const index = await indexOf(store, fs, config.rootDirs);
		return metaNotSynced(place(index, config, tools).unwrap(), fs);
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

		it("should describe whatever conversion a processor contributes", async () => {
			await write(
				"src/Inventory/Save.server.luau",
				"src/Inventory/Save.meta.json",
				"dist/Inventory/Save.server.luau",
				"dist/Inventory/Save.meta.yaml"
			);

			const warnings = await check({}, [
				{
					id: "yaml",
					metaReplacement: {
						suffix: ".meta.yaml",
						note: "Yaml it is.",
					},
				},
			]);

			expect(warnings[0].message).toContain(
				"The processor turned it into .meta.yaml"
			);
			expect(warnings[0].message).toContain("Yaml it is.");
		});

		it("should count only the meta files converted the way the message names", async () => {
			await write(
				"src/Inventory/Save.server.luau",
				"src/Inventory/Save.meta.json",
				"src/Inventory/Load.server.luau",
				"src/Inventory/Load.meta.json",
				"dist/Inventory/Save.server.luau",
				"dist/Inventory/Save.meta.yaml",
				"dist/Inventory/Load.server.luau",
				"dist/Inventory/Load.meta.toml"
			);

			const warnings = await check({}, [
				{
					id: "yaml",
					metaReplacement: { suffix: ".meta.yaml", note: "Yaml." },
				},
				{
					id: "toml",
					metaReplacement: { suffix: ".meta.toml", note: "Toml." },
				},
			]);

			expect(warnings[0].message).toContain(
				"The processor turned 1 of them into"
			);
		});

		it("should not mention a conversion when no processor contributes one", async () => {
			await write(
				"src/Inventory/Save.server.luau",
				"src/Inventory/Save.meta.json",
				"dist/Inventory/Save.server.luau",
				"dist/Inventory/Save.meta.lua"
			);

			const warnings = await check({}, []);

			expect(warnings[0].message).not.toContain("The processor turned");
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
