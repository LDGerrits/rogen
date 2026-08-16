import { FileConfigProvider } from "../file-provider.js";
import { MemoryFileSystemService } from "../../../fs/memory-file-system-service.js";

describe("FileConfigProvider", () => {
	let memFs: MemoryFileSystemService;

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
	});

	it("should parse a valid JSON config file", async () => {
		await memFs.writeFile(
			"/mock/.rogen.json",
			JSON.stringify({ key: "value" })
		);

		const provider = new FileConfigProvider(memFs, "/mock/.rogen.json");
		const result = await provider.load();

		expect(result.isOk()).toBe(true);
		expect(result.unwrap().key).toBe("value");
	});

	it("should yield an empty object if the config file does not exist but isOptional is true", async () => {
		const provider = new FileConfigProvider(
			memFs,
			"/mock/missing.json",
			true
		);
		const result = await provider.load();

		expect(result.isOk()).toBe(true);
		expect(result.unwrap()).toEqual({});
	});

	it("should return an error if a non-optional config file does not exist", async () => {
		const provider = new FileConfigProvider(
			memFs,
			"/mock/missing.json",
			false
		);
		const result = await provider.load();

		expect(result.isErr()).toBe(true);
	});
});
