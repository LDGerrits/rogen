import path from "path";
import { ConfigSchema, parseConfig } from "../config.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResultError } from "../../../base/result.js";
import { RojoTree } from "../../rojo/rojo-project.js";

describe("Configuration Domain", () => {
	describe("ConfigSchema", () => {
		it("should populate default values when parsing an empty object", () => {
			const result = ConfigSchema.safeParse({});
			expect(result.success).toBe(true);
			expect(result.data?.source).toEqual(["src"]);
			expect(result.data?.casing).toBe("camelCase");
		});

		it("should normalize shorthand casing string values", () => {
			const result1 = ConfigSchema.safeParse({ casing: "pascal" });
			expect(result1.success).toBe(true);
			expect(result1.data?.casing).toBe("PascalCase");
		});

		it("should block typos by pushing them to the catchall", () => {
			const result = ConfigSchema.safeParse({ sourc: "lib" });
			expect(result.success).toBe(false);
			expect(result.error?.issues[0]?.path).toEqual(["sourc"]);
		});
	});

	describe("parseConfig", () => {
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
			const result = await parseConfig(rawConfig, mockDir, memFs);

			expect(result.isOk()).toBe(true);
			const config = result.unwrap();

			expect(config.casing).toBe("PascalCase");
			expect((config.template as RojoTree).name).toBe("ResolvedProject");
		});

		it("should reject if the template file does not exist", async () => {
			const result = await parseConfig(
				{ template: "missing.json" },
				mockDir,
				memFs
			);
			expect(result.isErr()).toBe(true);
			expect((result as ResultError<Error>).error.message).toContain(
				"template file not found"
			);
		});
	});
});
