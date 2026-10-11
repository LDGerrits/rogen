import { jest } from "@jest/globals";
import path from "path";
import { DisposableStore } from "../../../base/disposable.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { RojoProjectFile } from "../../rojo/rojo-project.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { OutFileGuard, OutputFile, PendingWrite } from "../build.js";
import { OutputWriter } from "../output-writer.js";

const stagingPattern = (file: string) => new OutputFile(file).stagingPattern;

const outFile = path.resolve("/repo", "default.project.json");

const treeOf = (): RojoProjectFile => ({
	tree: {
		ReplicatedStorage: { $className: "ReplicatedStorage" },
		$className: "DataModel",
	},
	name: "repo",
});

describe("OutputWriter", () => {
	let fs: MemoryFileSystemService;
	let writer: OutputWriter;
	let store: DisposableStore;

	const write = (tree: RojoProjectFile) =>
		writer.write(new OutputFile(outFile), tree);

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		store = new DisposableStore();
		writer = new OutputWriter(fs);
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	describe("write", () => {
		it("should write the tree as JSON with sorted keys", async () => {
			const result = await write(treeOf());

			expect(result.unwrap()).toBe(true);
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

			expect(result.unwrap()).toBe(false);
			expect(listener).not.toHaveBeenCalled();
		});

		it("should rewrite the file when the tree changed", async () => {
			await write(treeOf());

			const result = await write({
				...treeOf(),
				name: "other",
			});

			expect(result.unwrap()).toBe(true);
			expect(JSON.parse(await fs.readFile(outFile)).name).toBe("other");
		});

		it("should replace a hand-written project file", async () => {
			await fs.writeFile(outFile, '{ "name": "by hand", "tree": {} }');

			const result = await write(treeOf());

			expect(result.unwrap()).toBe(true);
			expect(JSON.parse(await fs.readFile(outFile))).toEqual(treeOf());
		});

		it("should return a diagnostic when the file cannot be written", async () => {
			await fs.createDirectory(outFile);

			const result = await write(treeOf());

			expect(result.isErr()).toBe(true);
			expect(
				result.isErr() ? result.error.diagnostics[0] : undefined
			).toMatchObject({
				code: "output.writeFailed",
				resource: outFile,
				message:
					"the project file could not be written: illegal operation on a directory.",
			});
			const entries = await fs.readDirectory(path.dirname(outFile));
			expect(entries.map(([name]) => name)).toEqual([
				path.basename(outFile),
			]);
		});
	});
	describe("write beside a guard", () => {
		const pending: PendingWrite = {
			file: outFile,
			label: "default",
			setting: { mode: "prod", variants: { mock: false } },
		};
		const refusal: Diagnostic = errorDiagnostic(
			"output.servedInOtherMode",
			{ resource: outFile },
			"served"
		);
		let asked: PendingWrite[];
		let answer: Diagnostic | undefined;

		beforeEach(() => {
			asked = [];
			answer = undefined;
			const guard: OutFileGuard = async (write) => {
				asked.push(write);
				return answer;
			};
			writer = new OutputWriter(fs, guard);
		});

		it("should write when the guard has no objection", async () => {
			const result = await writer.write(
				new OutputFile(outFile),
				treeOf(),
				pending
			);

			expect(result.unwrap()).toBe(true);
			expect(asked).toEqual([pending]);
		});

		it("should leave the file and its staging files alone when the guard refuses", async () => {
			await fs.writeFile(outFile, "old\n");
			answer = refusal;

			const result = await writer.write(
				new OutputFile(outFile),
				treeOf(),
				pending
			);

			expect(result.isErr()).toBe(true);
			expect(result.isErr() && result.error.diagnostics).toEqual([
				refusal,
			]);
			expect(await fs.readFile(outFile)).toBe("old\n");
			expect(
				(await fs.readDirectory("/repo")).map(([name]) => name)
			).toEqual(["default.project.json"]);
		});

		it("should not ask the guard when the bytes would not change", async () => {
			await writer.write(new OutputFile(outFile), treeOf(), pending);
			asked = [];
			answer = refusal;

			const result = await writer.write(
				new OutputFile(outFile),
				treeOf(),
				pending
			);

			expect(result.unwrap()).toBe(false);
			expect(asked).toEqual([]);
		});
	});
});
