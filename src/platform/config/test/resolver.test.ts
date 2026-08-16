import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";
import { ConfigResolver } from "../resolver.js";
import { RojoTree } from "../../rojo/tree.js";
import { ResultError } from "../../../base/result.js";

describe("ConfigResolver", () => {
	let memFs: MemoryFileSystemService;
	let resolver: ConfigResolver;

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
		resolver = new ConfigResolver(memFs);
	});

	it("should return the config unmodified if template is an object", async () => {
		const mockTree = { name: "tree", tree: {} };
		const result = await resolver.resolveDependencies({
			template: mockTree,
		});

		expect(result.isOk()).toBe(true);
		expect(result.unwrap().template).toEqual(mockTree);
	});

	it("should return the config unmodified if template is not provided", async () => {
		const result = await resolver.resolveDependencies({ source: "src" });

		expect(result.isOk()).toBe(true);
		expect(result.unwrap().template).toBeUndefined();
	});

	it("should resolve a string template path to a JSON object", async () => {
		await memFs.writeFile(
			"custom.project.json",
			JSON.stringify({ name: "resolved-tree", tree: {} })
		);

		const result = await resolver.resolveDependencies({
			template: "custom.project.json",
		});

		expect(result.isOk()).toBe(true);
		expect((result.unwrap().template as RojoTree).name).toBe(
			"resolved-tree"
		);
	});

	it("should return an error if a string template file does not exist", async () => {
		const result = await resolver.resolveDependencies({
			template: "missing.json",
		});

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Specified template file not found"
		);
	});

	it("should return an error if the resolved template file contains invalid JSON", async () => {
		await memFs.writeFile("broken.json", "invalid json}");

		const result = await resolver.resolveDependencies({
			template: "broken.json",
		});

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Failed to parse template JSON"
		);
	});
});
