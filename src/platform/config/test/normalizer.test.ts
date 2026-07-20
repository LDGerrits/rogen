import { jest } from "@jest/globals";
import { IFileSystem } from "../../fs/file-system.js";
import { ConfigNormalizer } from "../normalizer.js";

describe("ConfigNormalizer", () => {
	let mockFs: jest.Mocked<IFileSystem>;
	let normalizer: ConfigNormalizer;

	beforeEach(() => {
		mockFs = {
			exists: jest.fn(),
			readFile: jest.fn(),
		} as unknown as jest.Mocked<IFileSystem>;

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
		if (result.isOk()) {
			const config = result.unwrap();
			expect((config.template as any).name).toBe("resolved-tree");
		}
	});

	it("should return an error if a string template file does not exist", async () => {
		mockFs.exists.mockResolvedValue(false);

		const result = await normalizer.normalize({ template: "missing.json" });
		expect(result.isErr()).toBe(true);
	});
});
