import { jest } from "@jest/globals";
import { FileSystemService } from "../../../fs/file-system-service.js";
import { CliConfigProvider } from "../cli.js";
import { FileConfigProvider } from "../file.js";

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
		let mockFs: jest.Mocked<FileSystemService>;

		beforeEach(() => {
			mockFs = {
				exists: jest.fn(),
				readFile: jest.fn(),
			} as unknown as jest.Mocked<FileSystemService>;
		});

		it("should parse a valid JSON config file", async () => {
			mockFs.exists.mockResolvedValue(true);
			mockFs.readFile.mockResolvedValue(
				JSON.stringify({ casing: "PascalCase" })
			);

			const provider = new FileConfigProvider(
				"/mock",
				mockFs,
				"/mock/.rogen.json"
			);

			const result = await provider.load();

			expect(result.isOk()).toBe(true);
			expect(result.unwrap().casing).toBe("PascalCase");
		});

		it("should yield an empty object if no config file exists and none was explicitly requested", async () => {
			mockFs.exists.mockResolvedValue(false);

			const provider = new FileConfigProvider("/mock", mockFs);
			const result = await provider.load();

			expect(result.isOk()).toBe(true);
			expect(result.unwrap()).toEqual({});
		});

		it("should return an error if an explicitly requested config file does not exist", async () => {
			mockFs.exists.mockResolvedValue(false);

			const provider = new FileConfigProvider(
				"/mock",
				mockFs,
				"required.json"
			);
			const result = await provider.load();

			expect(result.isErr()).toBe(true);
		});
	});
});
