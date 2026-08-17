import { ConfigReader } from "../config-reader.js";
import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";
import { ResultError } from "../../../base/result.js";

describe("ConfigReader", () => {
	let memFs: MemoryFileSystemService;
	let reader: ConfigReader;

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
		reader = new ConfigReader(memFs);
	});

	it("should return an empty object merged with overrides if an optional config is missing", async () => {
		const overrides = { source: ["cli-src"] };
		const result = await reader.read({
			configPath: "/missing.json",
			isOptional: true,
			overrides,
		});

		expect(result.isOk()).toBe(true);
		expect(result.unwrap()).toEqual({ source: ["cli-src"] });
	});

	it("should return an error if a required config is missing", async () => {
		const result = await reader.read({
			configPath: "/missing.json",
			isOptional: false,
		});

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Specified config file not found"
		);
	});

	it("should deep merge the JSON file with the provided overrides (overrides take precedence)", async () => {
		await memFs.writeFile(
			"/.rogen.json",
			JSON.stringify({
				casing: "PascalCase",
				source: "file-src",
				unwrap: true,
			})
		);

		const overrides = { source: ["override-src"], verbatim: true };

		const result = await reader.read({
			configPath: "/.rogen.json",
			isOptional: false,
			overrides,
		});

		expect(result.isOk()).toBe(true);

		const finalConfig = result.unwrap();

		expect(finalConfig.casing).toBe("PascalCase");
		expect(finalConfig.unwrap).toBe(true);
		expect(finalConfig.verbatim).toBe(true);
		expect(finalConfig.source).toEqual(["override-src"]);
	});

	it("should return an error if the JSON file contains invalid syntax", async () => {
		await memFs.writeFile("/.rogen.json", "{ bad_json: true, }");

		const result = await reader.read({
			configPath: "/.rogen.json",
			isOptional: false,
		});

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Failed to parse config JSON"
		);
	});
});
