import { DisposableStore } from "../../../../../base/disposable.js";
import { Diagnostic } from "../../../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../../../config/config.js";
import { place } from "../../../pipeline/pipeline.js";
import { nothingEmitted } from "../nothing-emitted.js";
import {
	abs,
	configOf as baseConfigOf,
	indexOf,
	syncTools,
} from "../../../__tests__/fixtures.js";

const configOf = (overrides: Partial<ResolvedConfig> = {}): ResolvedConfig =>
	baseConfigOf({ syncDir: abs("out"), ...overrides });

describe("nothingEmitted", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const check = async (
		fs: MemoryFileSystemService,
		config: ResolvedConfig
	): Promise<Diagnostic[]> => {
		const index = await indexOf(store, fs, config.rootDirs);
		return nothingEmitted.check(
			place(index, config, syncTools).unwrap(),
			fs
		);
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("rule", () => {
		it("should report nothing without a syncDir", async () => {
			await fs.writeFile(abs("src/Inventory/A.luau"), "");

			expect(await check(fs, configOf({ syncDir: undefined }))).toEqual(
				[]
			);
		});

		it("should report nothing when the emitted paths exist", async () => {
			await fs.writeFile(abs("src/Inventory/A.ts"), "");
			await fs.writeFile(abs("out/Inventory/A.luau"), "");

			expect(await check(fs, configOf())).toEqual([]);
		});

		it("should report nothing when only some of a root dir's paths exist", async () => {
			await fs.writeFile(abs("src/Inventory/A.ts"), "");
			await fs.writeFile(abs("src/Combat/B.ts"), "");
			await fs.writeFile(abs("out/Combat/B.luau"), "");

			expect(await check(fs, configOf())).toEqual([]);
		});

		it("should skip a root dir that does not exist", async () => {
			expect(await check(fs, configOf())).toEqual([]);
		});

		it("should skip a root dir with nothing in it", async () => {
			await fs.createDirectory(abs("src"));

			expect(await check(fs, configOf())).toEqual([]);
		});

		it("should warn when the sync dir does not exist, pointing at the nearest path that does", async () => {
			await fs.writeFile(abs("src/Inventory/A.ts"), "");

			const warnings = await check(fs, configOf());

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toMatchObject({
				code: "output.nothingEmitted",
				resource: abs("src"),
			});
			expect(warnings[0].message).toContain('root dir "src"');
			expect(warnings[0].message).toContain('under "out"');
			expect(warnings[0].message).toContain(
				'nearest path that exists is "."'
			);
		});

		it("should warn once for the root dir whose paths went missing and stay quiet for the other", async () => {
			await fs.writeFile(abs("src/Inventory/A.ts"), "");
			await fs.writeFile(abs("tests/Inventory.spec.ts"), "");
			await fs.writeFile(abs("out/Inventory/A.luau"), "");
			await fs.writeFile(abs("out/tests/Inventory.spec.luau"), "");

			const warnings = await check(
				fs,
				configOf({ rootDirs: [abs("src"), abs("tests")] })
			);

			expect(warnings).toHaveLength(1);
			expect(warnings[0].resource).toBe(abs("src"));
			expect(warnings[0].message).toContain('root dir "src"');
			expect(warnings[0].message).toContain('under "out/src"');
			expect(warnings[0].message).toContain('Found "out/Inventory"');
		});

		it("should find output rooted one level deeper than expected", async () => {
			await fs.writeFile(abs("src/Inventory/A.ts"), "");
			await fs.writeFile(abs("out/src/Inventory/A.luau"), "");

			const warnings = await check(fs, configOf());

			expect(warnings).toHaveLength(1);
			expect(warnings[0].message).toContain('under "out"');
			expect(warnings[0].message).toContain('Found "out/src/Inventory"');
		});

		it("should ignore dotfiles such as marker files", async () => {
			await fs.writeFile(abs("src/.server"), "");
			await fs.writeFile(abs("src/Inventory/A.luau"), "");
			await fs.writeFile(abs("out/Inventory/A.luau"), "");

			expect(await check(fs, configOf())).toEqual([]);
		});
	});
});
