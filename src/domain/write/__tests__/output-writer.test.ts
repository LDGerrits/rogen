import { jest } from "@jest/globals";
import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { RojoProjectFile } from "../../rojo/rojo-project.js";
import { OutputFile } from "../write.js";
import { OutputWriter } from "../output-writer.js";

const stagingPattern = (file: string) => new OutputFile(file).stagingPattern;

const projectFile = path.resolve("/repo", "default.project.json");

const treeOf = (): RojoProjectFile => ({
	tree: {
		ReplicatedStorage: { $className: "ReplicatedStorage" },
		$className: "DataModel",
	},
});

const named = (name: string): RojoProjectFile => ({ ...treeOf(), name });

describe("OutputWriter", () => {
	let fs: MemoryFileSystemService;
	let writer: OutputWriter;
	let store: DisposableStore;

	const write = (tree: RojoProjectFile) =>
		writer.write(new OutputFile(projectFile), tree);

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
		writer = new OutputWriter(fs);
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("write", () => {
		it("should write the tree as Rojo formats it, without a trailing newline", async () => {
			const result = await write(treeOf());

			expect(result.unwrap()).toBe(true);
			expect(await fs.readFile(projectFile)).toBe(
				[
					"{",
					'  "tree": {',
					'    "$className": "DataModel",',
					'    "ReplicatedStorage": {',
					'      "$className": "ReplicatedStorage"',
					"    }",
					"  }",
					"}",
				].join("\n")
			);
		});

		it("should write bytes that are already there when asked to rewrite", async () => {
			await write(treeOf());

			const result = await writer.write(
				new OutputFile(projectFile),
				treeOf(),
				{ force: true }
			);

			expect(result.unwrap()).toBe(true);
		});

		it("should leave bytes that are already there alone", async () => {
			await write(treeOf());

			expect((await write(treeOf())).unwrap()).toBe(false);
		});

		it("should write the name before the tree when the file has one", async () => {
			await write(named("lobby"));

			const content = await fs.readFile(projectFile);
			expect(Object.keys(JSON.parse(content))).toEqual(["name", "tree"]);
			expect(JSON.parse(content).name).toBe("lobby");
		});

		it("should write no name when the file has none", async () => {
			await write(treeOf());

			expect(
				Object.keys(JSON.parse(await fs.readFile(projectFile)))
			).toEqual(["tree"]);
		});

		it("should write through a temporary file and leave none behind", async () => {
			const events: string[] = [];
			store.add(fs.onDidMutateFile((event) => events.push(event.path)));

			await write(treeOf());

			const staged = events.filter((event) =>
				stagingPattern(projectFile).test(event)
			);
			expect(staged.length).toBeGreaterThan(0);
			for (const file of staged)
				expect(await fs.exists(file)).toBe(false);
		});

		it("should stage each write through its own file", async () => {
			const events = new Set<string>();
			store.add(
				fs.onDidMutateFile((event) => {
					if (stagingPattern(projectFile).test(event.path))
						events.add(event.path);
				})
			);

			await write(treeOf());
			await write(named("other"));

			expect(events.size).toBe(2);
		});

		it("should let two concurrent writes to one output both succeed", async () => {
			const other = named("other");

			const [first, second] = await Promise.all([
				write(treeOf()),
				write(other),
			]);

			expect(first.isOk()).toBe(true);
			expect(second.isOk()).toBe(true);
			expect([
				OutputWriter.textOf(treeOf()),
				OutputWriter.textOf(other),
			]).toContain(await fs.readFile(projectFile));
		});

		it("should not touch the file when the bytes are unchanged", async () => {
			await write(treeOf());
			const listener = jest.fn();
			store.add(fs.onDidMutateFile(listener));

			const result = await write(treeOf());

			expect(result.unwrap()).toBe(false);
			expect(listener).not.toHaveBeenCalled();
		});

		it("should rewrite the file when the tree changed", async () => {
			await write(treeOf());

			const result = await write(named("other"));

			expect(result.unwrap()).toBe(true);
			expect(JSON.parse(await fs.readFile(projectFile)).name).toBe(
				"other"
			);
		});

		it("should replace a hand-written project file", async () => {
			await fs.writeFile(
				projectFile,
				'{ "name": "by hand", "tree": {} }'
			);

			const result = await write(treeOf());

			expect(result.unwrap()).toBe(true);
			expect(await fs.readFile(projectFile)).toBe(
				OutputWriter.textOf(treeOf())
			);
		});

		it("should write over a file Rogen wrote that was edited since", async () => {
			await write(treeOf());
			const file = JSON.parse(await fs.readFile(projectFile));
			file.tree.ServerStorage = { $className: "ServerStorage" };
			await fs.writeFile(projectFile, JSON.stringify(file));

			const result = await write(treeOf());

			expect(result.unwrap()).toBe(true);
			expect(await fs.readFile(projectFile)).toBe(
				OutputWriter.textOf(treeOf())
			);
		});

		it("should return a diagnostic when the file cannot be written", async () => {
			await fs.createDirectory(projectFile);

			const result = await write(treeOf());

			expect(result.isErr()).toBe(true);
			expect(
				result.isErr() ? result.error.diagnostics[0] : undefined
			).toMatchObject({
				code: "output.writeFailed",
				resource: projectFile,
				message:
					"the project file could not be written: illegal operation on a directory.",
			});
			const entries = await fs.readDirectory(path.dirname(projectFile));
			expect(entries.map(([name]) => name)).toEqual([
				path.basename(projectFile),
			]);
		});
	});
});
