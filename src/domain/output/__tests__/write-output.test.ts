import { jest } from "@jest/globals";
import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { RojoTree } from "../../rojo/rojo-tree.js";
import { writeOutput } from "../write-output.js";

const outFile = path.resolve("/repo", "default.project.json");

const treeOf = (): RojoTree => ({
	tree: {
		ReplicatedStorage: { $className: "ReplicatedStorage" },
		$className: "DataModel",
	},
	name: "repo",
});

describe("domain/output/write-output", () => {
	let fs: MemoryFileSystemService;

	beforeEach(() => {
		fs = new MemoryFileSystemService();
	});

	describe("writeOutput", () => {
		it("should write the tree as JSON with sorted keys", async () => {
			const result = await writeOutput(fs, { outFile }, treeOf());

			expect(result.unwrap().value.written).toBe(true);
			const content = await fs.readFile(outFile);
			expect(JSON.parse(content)).toEqual(treeOf());
			expect(Object.keys(JSON.parse(content))).toEqual(["name", "tree"]);
			expect(Object.keys(JSON.parse(content).tree)).toEqual([
				"$className",
				"ReplicatedStorage",
			]);
		});

		it("should write through a temporary file and leave none behind", async () => {
			const events: string[] = [];
			fs.onDidMutateFile((event) => events.push(event.path));

			await writeOutput(fs, { outFile }, treeOf());

			expect(events).toContain(`${outFile.replace(/\\/g, "/")}.tmp`);
			expect(await fs.exists(`${outFile}.tmp`)).toBe(false);
		});

		it("should not touch the file when the bytes are unchanged", async () => {
			await writeOutput(fs, { outFile }, treeOf());
			const listener = jest.fn();
			fs.onDidMutateFile(listener);

			const result = await writeOutput(fs, { outFile }, treeOf());

			expect(result.unwrap().value.written).toBe(false);
			expect(listener).not.toHaveBeenCalled();
		});

		it("should rewrite the file when the tree changed", async () => {
			await writeOutput(fs, { outFile }, treeOf());

			const result = await writeOutput(
				fs,
				{ outFile },
				{
					...treeOf(),
					name: "other",
				}
			);

			expect(result.unwrap().value.written).toBe(true);
			expect(JSON.parse(await fs.readFile(outFile)).name).toBe("other");
		});

		it("should replace a hand-written project file", async () => {
			await fs.writeFile(outFile, '{ "name": "by hand", "tree": {} }');

			const result = await writeOutput(fs, { outFile }, treeOf());

			expect(result.unwrap().value.written).toBe(true);
			expect(JSON.parse(await fs.readFile(outFile))).toEqual(treeOf());
		});

		it("should return a diagnostic when the file cannot be written", async () => {
			await fs.createDirectory(outFile);

			const result = await writeOutput(fs, { outFile }, treeOf());

			expect(result.isErr()).toBe(true);
			expect(result.isErr() ? result.error[0] : undefined).toMatchObject({
				code: "output.writeFailed",
				resource: outFile,
			});
			expect(await fs.exists(`${outFile}.tmp`)).toBe(false);
		});
	});
});
