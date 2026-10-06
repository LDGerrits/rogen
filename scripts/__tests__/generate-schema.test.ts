import fs from "fs";
import os from "os";
import path from "path";
import { generateSchema } from "../generate-schema.js";

describe("scripts/generate-schema", () => {
	describe("generateSchema", () => {
		let outDir: string;

		beforeEach(() => {
			outDir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-schema-"));
		});

		afterEach(() => {
			fs.rmSync(outDir, { recursive: true, force: true });
		});

		it("should write the config schema to every channel", () => {
			const channels = generateSchema(outDir, "2.1.0", []);

			expect(channels).toEqual(["2.1.0", "2", "latest"]);
			for (const channel of channels) {
				const schema = JSON.parse(
					fs.readFileSync(
						path.join(outDir, channel, "rogen.json"),
						"utf8"
					)
				) as { properties: Record<string, unknown> };
				expect(Object.keys(schema.properties)).toContain("rootDirs");
			}
		});
	});
});
