import { CliConfigProvider } from "../cli.js";
import { FileConfigProvider } from "../file.js";
import { MemoryFileSystemService } from "../../../fs/memory-file-system-service.js";

describe("Config Providers", () => {
	describe("CliConfigProvider", () => {
		it("should map CLI arguments to a raw config object", async () => {
			const cliArgs = { source: ["cli-src"], build: "cli-out" };
			const provider = new CliConfigProvider("/mock", cliArgs);

			const result = await provider.load();

			expect(result.isOk()).toBe(true);

			const config = result.unwrap() as {
				source?: string[];
				luau?: { build?: string };
				ts?: { build?: string };
			};

			expect(config.source).toEqual(["cli-src"]);
			expect(config.luau?.build).toBe("cli-out");
			expect(config.ts?.build).toBe("cli-out");
		});
	});

	describe("FileConfigProvider", () => {
		let memFs: MemoryFileSystemService;

		beforeEach(() => {
			memFs = new MemoryFileSystemService();
		});

		it("should parse a valid JSON config file", async () => {
			await memFs.writeFile(
				"/mock/.rogen.json",
				JSON.stringify({ casing: "PascalCase" })
			);

			const provider = new FileConfigProvider(
				"/mock",
				memFs,
				"/mock/.rogen.json"
			);
			const result = await provider.load();

			expect(result.isOk()).toBe(true);
			expect(result.unwrap().casing).toBe("PascalCase");
		});

		it("should yield an empty object if no config file exists and none was explicitly requested", async () => {
			const provider = new FileConfigProvider("/mock", memFs);
			const result = await provider.load();

			expect(result.isOk()).toBe(true);
			expect(result.unwrap()).toEqual({});
		});

		it("should return an error if an explicitly requested config file does not exist", async () => {
			const provider = new FileConfigProvider(
				"/mock",
				memFs,
				"required.json"
			);
			const result = await provider.load();

			expect(result.isErr()).toBe(true);
		});
	});
});
