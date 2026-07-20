import { jest } from "@jest/globals";
import { IFileSystem } from "../../../fs/file-system.js";
import { CliConfigProvider } from "../cli.js";
import { FileConfigProvider } from "../file.js";

describe("Config Providers", () => {
	describe("CliConfigProvider", () => {
		it("should map CLI arguments to a UserConfig object", async () => {
			const cliArgs = { source: ["cli-src"], build: "cli-out" };
			const provider = new CliConfigProvider(cliArgs);

			const result = await provider.read({ cwd: "/mock" });

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				const config = result.unwrap();
				expect(config.source).toEqual(["cli-src"]);
				expect(config.luau?.build).toBe("cli-out");
				expect(config.ts?.build).toBe("cli-out");
			}
		});
	});

	describe("FileConfigProvider", () => {
		let mockFs: jest.Mocked<IFileSystem>;

		beforeEach(() => {
			mockFs = {
				exists: jest.fn(),
				readFile: jest.fn(),
			} as unknown as jest.Mocked<IFileSystem>;
		});

		it("should parse a valid JSON config file", async () => {
			mockFs.exists.mockResolvedValue(true);
			mockFs.readFile.mockResolvedValue(
				JSON.stringify({ casing: "PascalCase" })
			);

			const provider = new FileConfigProvider(mockFs);
			const result = await provider.read({
				cwd: "/mock",
				configPath: "/mock/.rogen.json",
			});

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.unwrap().casing).toBe("PascalCase");
			}
		});

		it("should yield an empty object if no config file exists and none was explicitly requested", async () => {
			mockFs.exists.mockResolvedValue(false);

			const provider = new FileConfigProvider(mockFs);
			const result = await provider.read({ cwd: "/mock" });

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.unwrap()).toEqual({});
			}
		});

		it("should return an error if an explicitly requested config file does not exist", async () => {
			mockFs.exists.mockResolvedValue(false);

			const provider = new FileConfigProvider(mockFs);
			const result = await provider.read({
				cwd: "/mock",
				configPath: "required.json",
			});

			expect(result.isErr()).toBe(true);
		});
	});
});
