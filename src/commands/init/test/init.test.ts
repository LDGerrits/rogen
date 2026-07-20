import { jest } from "@jest/globals";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { InitCommand } from "../init.js";
import { ResultError } from "../../../base/result.js";

describe("InitCommand", () => {
	let mockFs: jest.Mocked<FileSystemService>;

	beforeEach(() => {
		mockFs = {
			exists: jest.fn(),
			writeFile: jest.fn(),
		} as unknown as jest.Mocked<FileSystemService>;
	});

	it("should return an error if .rogen.json already exists", async () => {
		mockFs.exists.mockImplementation(async (p) =>
			String(p).endsWith(".rogen.json")
		);

		const command = new InitCommand("/mock/cwd", mockFs);
		const result = await command.execute();

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"A .rogen.json file already exists in this directory."
		);
		expect(mockFs.writeFile).not.toHaveBeenCalled();
	});

	it("should generate a clean Luau config when no toolchains are detected", async () => {
		mockFs.exists.mockResolvedValue(false);

		const command = new InitCommand("/mock/my-game", mockFs);
		const result = await command.execute();

		expect(result.isOk()).toBe(true);
		expect(mockFs.writeFile).toHaveBeenCalledTimes(1);

		const [, writtenContent] = mockFs.writeFile.mock.calls[0];
		const config = JSON.parse(writtenContent as string);

		expect(config.luau).toBeDefined();
		expect(config.ts).toBeUndefined();
		expect(config.darklua).toBeUndefined();

		expect(config.template.name).toBe("my-game");
		expect(config.template.tree).toEqual({ $className: "DataModel" });
		expect(config.template.globIgnorePaths).toEqual([]);
	});

	it("should tailor the config for TypeScript and Wally, injecting correct workspace packages", async () => {
		mockFs.exists.mockImplementation(async (p) => {
			const pathStr = String(p).replace(/\\/g, "/");
			if (pathStr.endsWith(".rogen.json")) return false;

			if (pathStr.endsWith("tsconfig.json")) return true;
			if (pathStr.endsWith("wally.toml")) return true;
			if (pathStr.endsWith(".darklua.json")) return false;

			if (pathStr.endsWith("node_modules/@rbxts")) return true;
			if (pathStr.endsWith("Packages")) return true;

			return false;
		});

		const command = new InitCommand("/mock/ts-game", mockFs);
		const result = await command.execute();

		expect(result.isOk()).toBe(true);

		const [, writtenContent] = mockFs.writeFile.mock.calls[0];
		const config = JSON.parse(writtenContent as string);

		expect(config.ts).toBeDefined();
		expect(config.luau).toBeUndefined();
		expect(config.darklua).toBeUndefined();

		expect(config.template.globIgnorePaths).toContain("**/tsconfig.json");

		const tree = config.template.tree;

		expect(
			tree.ReplicatedStorage.rbxts_include.node_modules["@rbxts"]
		).toBeDefined();

		expect(tree.ReplicatedStorage.Packages).toBeDefined();
	});

	it("should return a structured error if writing the config file to disk fails", async () => {
		mockFs.exists.mockResolvedValue(false);
		mockFs.writeFile.mockRejectedValue(new Error("Permission denied"));

		const command = new InitCommand("/mock/cwd", mockFs);
		const result = await command.execute();

		expect(result.isErr()).toBe(true);
		expect((result as ResultError<Error>).error.message).toContain(
			"Failed to write .rogen.json"
		);
		expect((result as ResultError<Error>).error.message).toContain(
			"Permission denied"
		);
	});
});
