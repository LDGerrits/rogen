import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { selectionOf } from "../../config/__tests__/mock-config-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import {
	abs,
	configOf,
	writeServiceOf,
} from "../../write/__tests__/fixtures.js";
import { MirrorPlan, Operation } from "../mirror-plan.js";
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
});
