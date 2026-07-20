import { jest } from "@jest/globals";
import { FileSystemService } from "../../fs/file-system-service.js";
import { ConfigNormalizer } from "../normalizer.js";
import { RojoTree } from "../../rojo/tree.js";

describe("ConfigNormalizer", () => {
	let mockFs: jest.Mocked<FileSystemService>;
	let normalizer: ConfigNormalizer;

	beforeEach(() => {
		mockFs = {
			exists: jest.fn(),
			readFile: jest.fn(),
		} as unknown as jest.Mocked<FileSystemService>;

		normalizer = new ConfigNormalizer(mockFs);
	});

	it("should wrap a string source into an array", async () => {
		const result = await normalizer.normalize({ source: "lib" });
		expect(result.unwrap().source).toEqual(["lib"]);
	});

	it("should leave an array source intact", async () => {
		const result = await normalizer.normalize({ source: ["src", "lib"] });
		expect(result.unwrap().source).toEqual(["src", "lib"]);
	});

	it("should resolve a string template path to a JSON object", async () => {
		mockFs.exists.mockResolvedValue(true);
		mockFs.readFile.mockResolvedValue(
			JSON.stringify({ name: "resolved-tree", tree: {} })
		);

		const result = await normalizer.normalize({
			template: "custom.project.json",
		});

		expect(result.isOk()).toBe(true);

		const config = result.unwrap();
		expect((config.template as RojoTree).name).toBe("resolved-tree");
	});

	it("should return an error if a string template file does not exist", async () => {
		mockFs.exists.mockResolvedValue(false);

		const result = await normalizer.normalize({ template: "missing.json" });
		expect(result.isErr()).toBe(true);
	});
});
