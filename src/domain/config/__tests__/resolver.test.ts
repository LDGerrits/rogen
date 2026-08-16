import { ConfigResolver } from "../resolver.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { RojoTree } from "../../rojo/tree.js";
import { ResultError } from "../../../base/result.js";
import path from "path";

describe("ConfigResolver (Domain)", () => {
	let memFs: MemoryFileSystemService;
	let resolver: ConfigResolver;

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
		resolver = new ConfigResolver(memFs);
	});

	it("should return the config unmodified if template is an object", async () => {
		const mockTree = { name: "tree", tree: {} };
		const result = await resolver.resolveDependencies(
			{ template: mockTree },
			"/mock/cwd"
		);

		expect(result.isOk()).toBe(true);
		expect(result.unwrap().template).toEqual(mockTree);
	});

	it("should return the config unmodified if template is not provided", async () => {
		const result = await resolver.resolveDependencies(
			{ source: "src" },
			"/mock/cwd"
		);

		expect(result.isOk()).toBe(true);
		expect(result.unwrap().template).toBeUndefined();
	});

	it("should resolve a string template path relative to the provided configDir", async () => {
		const configDir = path.resolve("/mock/cwd");
		const templatePath = path.resolve(configDir, "custom.project.json");

		await memFs.writeFile(
			templatePath,
			JSON.stringify({ name: "resolved-tree", tree: {} })
		);

		const result = await resolver.resolveDependencies(
			{ template: "custom.project.json" },
			configDir
		);

		expect(result.isOk()).toBe(true);
		expect((result.unwrap().template as RojoTree).name).toBe(
			"resolved-tree"
		);
	});

	it("should return an error if a string template file does not exist", async () => {
		const result = await resolver.resolveDependencies(
			{ template: "missing.json" },
			"/mock/cwd"
		);

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Specified template file not found"
		);
	});
});
