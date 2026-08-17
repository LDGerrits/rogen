import path from "path";
import { ConfigParser } from "../config-parser.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResultError } from "../../../base/result.js";
import { RojoTree } from "../../rojo/rojo-project.js";

describe("ConfigParser", () => {
	let memFs: MemoryFileSystemService;

	const mockDir = path.resolve(process.cwd(), "mock");

	beforeEach(() => {
		memFs = new MemoryFileSystemService();
	});

	it("should resolve a string template path, inject defaults, and validate", async () => {
		const templatePath = path.resolve(mockDir, "base.project.json");
		await memFs.writeFile(
			templatePath,
			JSON.stringify({ name: "ResolvedProject", tree: {} })
		);

		const rawConfig = {
			template: "base.project.json",
			casing: "PascalCase",
		};

		const result = await ConfigParser.parse(rawConfig, mockDir, memFs);

		if (result.isErr()) {
			console.error(
				"Test Failed with Error:",
				(result as ResultError<Error>).error.message
			);
		}

		expect(result.isOk()).toBe(true);
		const config = result.unwrap();

		expect(config.casing).toBe("PascalCase");
		expect(config.source).toEqual(["src"]);
		expect(typeof config.template).toBe("object");
		expect((config.template as RojoTree).name).toBe("ResolvedProject");
	});

	it("should reject if the template file does not exist", async () => {
		const rawConfig = { template: "missing.json" };
		const result = await ConfigParser.parse(rawConfig, mockDir, memFs);

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Specified template file not found"
		);
	});

	it("should reject configurations that violate the Zod schema", async () => {
		const rawConfig = { verbatim: "not-a-boolean" };
		const result = await ConfigParser.parse(rawConfig, mockDir, memFs);

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Configuration validation failed"
		);
		expect((result as ResultError<Error>).error.message).toContain(
			"verbatim"
		);
	});
});
