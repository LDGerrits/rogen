import { err } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { selectionOf } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import {
	abs,
	configOf,
	writeServiceOf,
} from "../../write/__tests__/fixtures.js";
import { ROUTES } from "./layout-fixtures.js";
import { WriteService } from "../../write/write-service.js";
import { Expected, MirrorPlan, Operation } from "../mirror-plan.js";
import { PlanWriter } from "../plan-writer.js";
import { SyncbackRequest } from "../syncback.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const write = (file: string, text = "new"): Operation => ({
	kind: "write",
	file,
	instance: file,
	bytes: bytes(text),
});
const remove = (file: string): Operation => ({
	kind: "remove",
	file,
	instance: file,
});
const prune = (file: string): Operation => ({
	kind: "prune",
	file,
	instance: file,
});

describe("PlanWriter", () => {
	let fs: MemoryFileSystemService;
	let config: ResolvedConfig;
	let request: SyncbackRequest;

	const planOf = (...operations: Operation[]) =>
		new MirrorPlan(config, [], [], operations, new Map(), [], []);

	const written = (...operations: Operation[]) =>
		new PlanWriter(fs, writeServiceOf(fs, new CoreIndexService(fs))).write(
			request,
			planOf(...operations)
		);

	const refuseWritesTo = (refused: string) => {
		const writeBytes = fs.writeFileBytes.bind(fs);
		fs.writeFileBytes = async (file, content) => {
			if (file === refused) throw new Error("denied");
			return writeBytes(file, content);
		};
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		config = configOf();
		request = {
			selection: selectionOf(config),
			project: config,
			input: "game.rbxl",
			cwd: "/repo",
		};
	});

	it("should remove a file before it makes a folder at its path", async () => {
		const at = abs("src/Thing");
		await fs.writeFile(at, "");

		await written({ kind: "folder", file: at, instance: at }, remove(at));

		expect(await fs.isDirectory(at)).toBe(true);
	});

	it("should write new files before it removes old ones", async () => {
		const old = abs("src/Old.luau");
		await fs.writeFile(old, "");
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

		await written(remove(old), write(abs("src/New.luau")));

		expect(calls).toEqual([
			`write ${abs("src/New.luau")}`,
			`remove ${old}`,
		]);
	});

	it("should keep a renamed file's old file when its new file could not be written", async () => {
		const old = abs("src/Bag.luau");
		const fresh = abs("src/Pouch.luau");
		await fs.writeFile(old, "");
		refuseWritesTo(fresh);

		const result = await written(remove(old), write(fresh));

		expect(await fs.exists(old)).toBe(true);
		expect(result.changes).toEqual([]);
		expect(result.unplaced).toEqual([
			{
				instance: fresh,
				reason: `${fresh} could not be changed: denied`,
			},
			{
				instance: old,
				reason: `${old} was kept, since another file could not be written`,
			},
		]);
	});

	it("should list a file it could not write, and write the rest", async () => {
		const refused = abs("src/Quest.luau");
		const fine = abs("src/Raid.luau");
		refuseWritesTo(refused);

		const result = await written(write(refused), write(fine));

		expect(await fs.exists(fine)).toBe(true);
		expect(result.changes).toEqual([{ kind: "write", file: fine }]);
		expect(result.unplaced).toMatchObject([
			{ reason: expect.stringContaining("denied") },
		]);
	});

	it("should remove a pruned folder only when nothing is left in it", async () => {
		const empty = abs("src/Empty");
		const kept = abs("src/Kept");
		await fs.createDirectory(`${empty}/Inner`);
		await fs.writeFile(`${kept}/Readme.md`, "");

		await written(prune(empty), prune(kept));

		expect(await fs.exists(empty)).toBe(false);
		expect(await fs.exists(`${kept}/Readme.md`)).toBe(true);
	});

	it("should keep the old files when a folder could not be made", async () => {
		const old = abs("src/Old.luau");
		const made = abs("src/Made");
		await fs.writeFile(old, "");
		fs.createDirectory = async () => {
			throw new Error("denied");
		};

		const result = await written(
			{ kind: "folder", file: made, instance: made },
			remove(old)
		);

		expect(await fs.exists(old)).toBe(true);
		expect(result.unplaced).toEqual([
			{ instance: made, reason: `${made} could not be changed: denied` },
			{
				instance: old,
				reason: `${old} was kept, since another file could not be written`,
			},
		]);
	});

	it("should go on removing old files when one could not be removed", async () => {
		const stuck = abs("src/Stuck.luau");
		const gone = abs("src/Gone.luau");
		await fs.writeFile(stuck, "");
		await fs.writeFile(gone, "");
		const deleted = fs.delete.bind(fs);
		fs.delete = async (file, recursive) => {
			if (file === stuck) throw new Error("busy");
			return deleted(file, recursive);
		};

		const result = await written(remove(stuck), remove(gone));

		expect(await fs.exists(gone)).toBe(false);
		expect(result.changes).toEqual([{ kind: "remove", file: gone }]);
		expect(result.unplaced).toEqual([
			{ instance: stuck, reason: `${stuck} could not be changed: busy` },
		]);
	});

	it("should leave a pruned folder that is already gone alone", async () => {
		const missing = abs("src/Missing");

		const result = await written(prune(missing));

		expect(result.unplaced).toEqual([]);
		expect(await fs.exists(missing)).toBe(false);
	});

	describe("checking where what it wrote lands", () => {
		const landing = (file: string, ...instance: string[]): Expected => ({
			file,
			instance,
		});

		const writtenExpecting = (
			expected: readonly Expected[],
			...operations: Operation[]
		) =>
			new PlanWriter(
				fs,
				writeServiceOf(fs, new CoreIndexService(fs))
			).write(
				request,
				new MirrorPlan(
					config,
					[],
					[],
					operations,
					new Map(),
					expected,
					[]
				)
			);

		beforeEach(() => {
			config = configOf({ routes: ROUTES });
			request = {
				...request,
				selection: selectionOf(config),
				project: config,
			};
		});

		it("should warn of a file that lands at another instance than it was written for", async () => {
			const file = abs("src/Inventory/Server/Bag.luau");

			const result = await writtenExpecting(
				[landing(file, "ServerScriptService", "Inventory", "Pouch")],
				write(file)
			);

			expect(result.warnings).toMatchObject([
				{
					code: "syncback.misplaced",
					resource: file,
					message:
						"this file was written for ServerScriptService/Inventory/Pouch, and lands at ServerScriptService/Inventory/Bag. Move it to where routing puts it at ServerScriptService/Inventory/Pouch.",
				},
			]);
		});

		it("should warn of a file that no instance comes from", async () => {
			const file = abs("src/Inventory/Server/notes.md");

			const result = await writtenExpecting(
				[landing(file, "ServerScriptService", "Inventory", "notes")],
				write(file)
			);

			expect(result.warnings).toMatchObject([
				{
					code: "syncback.misplaced",
					resource: file,
					message: `this file was written for ServerScriptService/Inventory/notes, and no instance comes from it. Check the routes of ${config.label}.`,
				},
			]);
		});

		it("should not warn of a file that lands where it was written for", async () => {
			const file = abs("src/Inventory/Server/Bag.luau");

			const result = await writtenExpecting(
				[landing(file, "ServerScriptService", "Inventory", "Bag")],
				write(file)
			);

			expect(result.warnings).toEqual([]);
		});

		it("should warn of every file when the project it wrote for is not among the configs located", async () => {
			const file = abs("src/Inventory/Server/Bag.luau");
			request = {
				...request,
				selection: selectionOf(
					configOf({ routes: ROUTES, file: abs("other.rogen.json") })
				),
			};

			const result = await writtenExpecting(
				[landing(file, "ServerScriptService", "Inventory", "Bag")],
				write(file)
			);

			expect(result.warnings).toMatchObject([
				{
					code: "syncback.misplaced",
					message: expect.stringContaining(
						"no instance comes from it"
					),
				},
			]);
		});

		it("should not warn when the files can't be located", async () => {
			const file = abs("src/Inventory/Server/Bag.luau");
			const unlocated = {
				locate: async () => err(new DiagnosticsError([])),
			} as unknown as WriteService;

			const result = await new PlanWriter(fs, unlocated).write(
				request,
				new MirrorPlan(
					config,
					[],
					[],
					[write(file)],
					new Map(),
					[
						landing(
							file,
							"ServerScriptService",
							"Inventory",
							"Pouch"
						),
					],
					[]
				)
			);

			expect(await fs.exists(file)).toBe(true);
			expect(result.warnings).toEqual([]);
		});
	});
});
