import { jest } from "@jest/globals";
import { FileSystemService } from "../../fs/file-system-service.js";
import { ConfigResolver } from "../resolver.js";
import { RojoTree } from "../../rojo/tree.js";
import { ResultError } from "../../../base/result.js";

describe("ConfigResolver", () => {
	let mockFs: jest.Mocked<FileSystemService>;
	let resolver: ConfigResolver;

	beforeEach(() => {
		mockFs = {
			exists: jest.fn(),
			readFile: jest.fn(),
		} as unknown as jest.Mocked<FileSystemService>;

		resolver = new ConfigResolver(mockFs);
	});

	it("should return the config unmodified if template is an object", async () => {
		const mockTree = { name: "tree", tree: {} };
		const result = await resolver.resolveDependencies({
			template: mockTree,
		});

		expect(result.isOk()).toBe(true);
		expect(result.unwrap().template).toEqual(mockTree);
		expect(mockFs.exists).not.toHaveBeenCalled();
	});

	it("should return the config unmodified if template is not provided", async () => {
		const result = await resolver.resolveDependencies({ source: "src" });

		expect(result.isOk()).toBe(true);
		expect(result.unwrap().template).toBeUndefined();
	});

	it("should resolve a string template path to a JSON object", async () => {
		mockFs.exists.mockResolvedValue(true);
		mockFs.readFile.mockResolvedValue(
			JSON.stringify({ name: "resolved-tree", tree: {} })
		);

		const result = await resolver.resolveDependencies({
			template: "custom.project.json",
		});

		expect(result.isOk()).toBe(true);

		const config = result.unwrap();
		expect((config.template as RojoTree).name).toBe("resolved-tree");
	});

	it("should return an error if a string template file does not exist", async () => {
		mockFs.exists.mockResolvedValue(false);

		const result = await resolver.resolveDependencies({
			template: "missing.json",
		});

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Specified template file not found"
		);
	});

	it("should return an error if the resolved template file contains invalid JSON", async () => {
		mockFs.exists.mockResolvedValue(true);
		mockFs.readFile.mockResolvedValue("invalid json}");

		const result = await resolver.resolveDependencies({
			template: "broken.json",
		});

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Failed to parse template JSON"
		);
	});
});
