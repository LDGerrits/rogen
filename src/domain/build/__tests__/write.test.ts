import { jest } from "@jest/globals";
import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { RojoTree } from "../../rojo/rojo-project.js";
import { BuiltProject, OutputFile } from "../build-service.js";
import { CoreBuildService } from "../core-build-service.js";
import { buildServiceOf } from "./fixtures.js";

const stagingPattern = (file: string) => new OutputFile(file).stagingPattern;

const outFile = path.resolve("/repo", "default.project.json");

const treeOf = (): RojoTree => ({
	tree: {
		ReplicatedStorage: { $className: "ReplicatedStorage" },
		$className: "DataModel",
	},
	name: "repo",
});

describe("CoreBuildService.write", () => {
	let fs: MemoryFileSystemService;
	let service: CoreBuildService;
	let store: DisposableStore;

	const projectOf = (tree: RojoTree): BuiltProject => ({
		outFile,
		tree,
		warnings: [],
		syncWarnings: [],
		readFiles: [],
		summary: {
			roots: [],
			routes: [],
			tags: [],
			unrouted: 0,
			superseded: 0,
			displaced: 0,
		},
	});
	const write = (tree: RojoTree) => service.write(projectOf(tree));

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
		service = buildServiceOf(fs, store.add(new CoreIndexService(fs)));
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("write", () => {
		it("should write the tree as JSON with sorted keys", async () => {
			const result = await write(treeOf());

			expect(result.unwrap().written).toBe(true);
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
			store.add(fs.onDidMutateFile((event) => events.push(event.path)));

			await write(treeOf());

			const staged = events.filter((event) =>
				stagingPattern(outFile).test(event)
			);
			expect(staged.length).toBeGreaterThan(0);
			for (const file of staged)
				expect(await fs.exists(file)).toBe(false);
		});

		it("should stage each write through its own file", async () => {
			const events = new Set<string>();
			store.add(
				fs.onDidMutateFile((event) => {
					if (stagingPattern(outFile).test(event.path))
						events.add(event.path);
				})
			);

			await write(treeOf());
			await write({ ...treeOf(), name: "other" });

			expect(events.size).toBe(2);
		});

		it("should let two concurrent writes to one output both succeed", async () => {
			const other = { ...treeOf(), name: "other" };

			const [first, second] = await Promise.all([
				write(treeOf()),
				write(other),
			]);

			expect(first.isOk()).toBe(true);
			expect(second.isOk()).toBe(true);
			const written = JSON.parse(await fs.readFile(outFile));
			expect([treeOf(), other]).toContainEqual(written);
		});

		it("should not touch the file when the bytes are unchanged", async () => {
			await write(treeOf());
			const listener = jest.fn();
			store.add(fs.onDidMutateFile(listener));

			const result = await write(treeOf());

			expect(result.unwrap().written).toBe(false);
			expect(listener).not.toHaveBeenCalled();
		});

		it("should rewrite the file when the tree changed", async () => {
			await write(treeOf());

			const result = await write({
				...treeOf(),
				name: "other",
			});

			expect(result.unwrap().written).toBe(true);
			expect(JSON.parse(await fs.readFile(outFile)).name).toBe("other");
		});

		it("should replace a hand-written project file", async () => {
			await fs.writeFile(outFile, '{ "name": "by hand", "tree": {} }');

			const result = await write(treeOf());

			expect(result.unwrap().written).toBe(true);
			expect(JSON.parse(await fs.readFile(outFile))).toEqual(treeOf());
		});

		it("should return a diagnostic when the file cannot be written", async () => {
			await fs.createDirectory(outFile);

			const result = await write(treeOf());

			expect(result.isErr()).toBe(true);
			expect(result.isErr() ? result.error[0] : undefined).toMatchObject({
				code: "output.writeFailed",
				resource: outFile,
			});
			const entries = await fs.readDirectory(path.dirname(outFile));
			expect(entries.map(([name]) => name)).toEqual([
				path.basename(outFile),
			]);
		});
	});
});
