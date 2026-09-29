import { DisposableStore } from "../../../../../base/disposable.js";
import { MemoryFileSystemService } from "../../../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfig } from "../../../../config/config.js";
import { assemble, place } from "../../pipeline.js";
import {
	abs,
	configOf,
	indexOf,
	syncTools,
} from "../../../__tests__/fixtures.js";

type Read = Pick<ResolvedConfig, "rootDirs" | "exclude">;

describe("readFolderMeta", () => {
	let fs: MemoryFileSystemService;
	let store: DisposableStore;

	const read = async (overrides: Partial<Read> = {}) => {
		const config: Read = {
			rootDirs: [abs("src")],
			exclude: [],
			...overrides,
		};
		const index = await indexOf(store, fs, config.rootDirs);
		const built = await assemble(
			place(index, configOf(config), syncTools).unwrap(),
			fs
		);
		return built.map(({ folderMeta }) => folderMeta);
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should read every init.meta.json with its folder and fields", async () => {
		await fs.writeFile(
			abs("src/Combat/init.meta.json"),
			JSON.stringify({
				className: "Actor",
				properties: { Enabled: false },
				attributes: { Priority: 1 },
				ignoreUnknownInstances: true,
				id: "combat",
			})
		);
		await fs.writeFile(abs("src/init.meta.json"), "{}");

		const result = await read();

		expect(result.unwrap()).toEqual([
			{
				file: abs("src/Combat/init.meta.json"),
				rootDir: abs("src"),
				dir: "Combat",
				className: "Actor",
				properties: { Enabled: false },
				attributes: { Priority: 1 },
				ignoreUnknownInstances: true,
				id: "combat",
			},
			{ file: abs("src/init.meta.json"), rootDir: abs("src"), dir: "" },
		]);
	});

	it("should skip a file's meta and an excluded folder's", async () => {
		await fs.writeFile(abs("src/Save.meta.json"), "{ broken");
		await fs.writeFile(abs("src/legacy/init.meta.json"), "{ broken");

		const result = await read({ exclude: [abs("src/legacy")] });

		expect(result.unwrap()).toEqual([]);
	});

	it("should accept comments, trailing commas and unknown fields", async () => {
		await fs.writeFile(
			abs("src/Combat/init.meta.json"),
			'{\n\t// an actor\n\t"$schema": "x",\n\t"className": "Actor",\n}'
		);

		const result = await read();

		expect(result.unwrap()).toEqual([
			{
				file: abs("src/Combat/init.meta.json"),
				rootDir: abs("src"),
				dir: "Combat",
				className: "Actor",
			},
		]);
	});

	it("should fail with the file and position when the JSONC is invalid", async () => {
		await fs.writeFile(
			abs("src/Combat/init.meta.json"),
			'{\n\t"className": }'
		);

		const result = await read();

		expect(result.isErr() ? result.error : []).toMatchObject([
			{
				code: "meta.invalidSyntax",
				resource: abs("src/Combat/init.meta.json"),
				position: { line: 2, column: 15 },
			},
		]);
	});

	it("should fail when the meta isn't an object", async () => {
		await fs.writeFile(abs("src/Combat/init.meta.json"), "[]");

		const result = await read();

		expect(result.isErr() ? result.error : []).toMatchObject([
			{
				code: "meta.notAnObject",
				resource: abs("src/Combat/init.meta.json"),
			},
		]);
	});

	it("should fail at the value when a known field has the wrong type", async () => {
		await fs.writeFile(
			abs("src/Combat/init.meta.json"),
			'{\n\t"className": 1,\n\t"attributes": []\n}'
		);

		const result = await read();

		const errors = result.isErr() ? result.error : [];
		expect(errors).toMatchObject([
			{ code: "meta.wrongType", position: { line: 2, column: 15 } },
			{ code: "meta.wrongType", position: { line: 3, column: 16 } },
		]);
		expect(errors[0].message).toBe(
			'"className": expected a string, found a number.'
		);
	});

	it("should report every invalid meta file at once", async () => {
		await fs.writeFile(abs("src/A/init.meta.json"), "{ broken");
		await fs.writeFile(abs("src/B/init.meta.json"), '{"id": true}');

		const result = await read();

		expect(
			new Set(
				result.isErr()
					? result.error.map(({ resource }) => resource)
					: []
			)
		).toEqual(
			new Set([abs("src/A/init.meta.json"), abs("src/B/init.meta.json")])
		);
	});
});
