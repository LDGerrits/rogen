import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { UndoLog } from "../undo-log.js";

describe("UndoLog", () => {
	const root = path.resolve("/repo");
	let fileSystem: MemoryFileSystemService;
	let log: UndoLog;
	const at = (file: string) => path.join(root, file);

	beforeEach(async () => {
		fileSystem = new MemoryFileSystemService();
		await fileSystem.createDirectory(root);
		log = instantiationOf([FileSystemService, fileSystem]).createInstance(
			UndoLog,
			root
		);
	});

	it("should name the new name of a rename it can't put back", async () => {
		await fileSystem.writeFile(at("A.luau"), "");
		await log.rename(at("A.luau"), at("B.luau"));
		await fileSystem.delete(at("B.luau"));

		expect(await log.undo()).toEqual(["B.luau"]);
	});

	it("should take everything in a folder that wasn't there before as added", async () => {
		const made = at("starter");

		await log.recordAdded(made, () =>
			fileSystem.writeFile(path.join(made, "package.json"), "{}")
		);
		const left = await log.undo();

		expect(left).toEqual([]);
		expect(await fileSystem.exists(path.join(made, "package.json"))).toBe(
			false
		);
	});
});
