import { DisposableStore } from "../../../base/disposable.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { BuildValidator } from "../build-validator.js";
import { TreeAssembler } from "../tree-assembler.js";
import {
	abs,
	configOf as baseConfigOf,
	indexOf,
	placeFiles,
	syncTools,
	writeFiles,
} from "./fixtures.js";

describe("BuildValidator", () => {
	describe("validate", () => {
		let fs: MemoryFileSystemService;
		let store: DisposableStore;

		beforeEach(() => {
			fs = new MemoryFileSystemService();
			store = new DisposableStore();
		});

		afterEach(() => {
			store[Symbol.dispose]();
		});

		it("should report rules in a fixed order, whatever order the problems arose in", async () => {
			await writeFiles(fs, "src/Orphan.meta.json", "src/Stray.luau");
			const config = baseConfigOf({
				rootDirs: [abs("src"), abs("missing")],
				routes: { server: "ServerScriptService" },
			});
			const index = await indexOf(store, fs, config.rootDirs);
			const assembled = (
				await new TreeAssembler(fs).assemble(
					placeFiles(index, config, syncTools).unwrap()
				)
			).unwrap();

			const warnings = new BuildValidator(assembled).validate();

			expect(warnings.map(({ code }) => code)).toEqual([
				"scan.missingRootDir",
				"meta.unclaimed",
				"route.unrouted",
			]);
		});

		it("should report nothing for a build that raises no problems", async () => {
			await writeFiles(fs, "src/Fine.luau");
			const config = baseConfigOf();
			const index = await indexOf(store, fs, config.rootDirs);
			const assembled = (
				await new TreeAssembler(fs).assemble(
					placeFiles(index, config, syncTools).unwrap()
				)
			).unwrap();

			expect(new BuildValidator(assembled).validate()).toEqual([]);
		});
	});
});
