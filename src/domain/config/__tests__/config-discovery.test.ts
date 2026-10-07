import { ConfigDiscovery, isConfigPath } from "../config-discovery.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { UsageError } from "../../../base/errors.js";
import { Result, ResultError } from "../../../base/result.js";

function errorOf(result: Result<unknown, Error>): Error {
	return (result as ResultError<Error>).error;
}

describe("isConfigPath", () => {
	it.each([
		"places/lobby.rogen.json",
		"../shared.rogen.json",
		"places\\lobby.rogen.json",
		"lobby.rogen.json",
		"odd.json",
	])("should read %s as a path", (ref) => {
		expect(isConfigPath(ref)).toBe(true);
	});

	it.each(["lobby", "default", "lobby.sync"])(
		"should read %s as a name",
		(ref) => {
			expect(isConfigPath(ref)).toBe(false);
		}
	);
});

describe("ConfigDiscovery", () => {
	let fs: MemoryFileSystemService;
	let discovery: ConfigDiscovery;
	const cwd = "/repo";

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(cwd);
		discovery = new ConfigDiscovery(fs, new MockEnvironmentService(cwd));
	});

	describe("with nothing named", () => {
		it("should resolve every *.rogen.json here, sorted", async () => {
			await fs.writeFile("/repo/match.rogen.json", "{}");
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/lobby.rogen.json", "{}");

			const result = await discovery.discover([]);

			expect(result.unwrap()).toEqual([
				"/repo/default.rogen.json",
				"/repo/lobby.rogen.json",
				"/repo/match.rogen.json",
			]);
		});

		it("should not need a default config", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");
			await fs.writeFile("/repo/match.rogen.json", "{}");

			const result = await discovery.discover([]);

			expect(result.unwrap()).toEqual([
				"/repo/lobby.rogen.json",
				"/repo/match.rogen.json",
			]);
		});

		it("should fail, pointing at init, when there is none", async () => {
			const result = await discovery.discover([]);

			expect(errorOf(result).message).toBe(
				'No *.rogen.json found in /repo. Run "rogen init" to create one.'
			);
			expect(errorOf(result)).not.toBeInstanceOf(UsageError);
		});

		it("should ignore a directory that happens to end in .rogen.json", async () => {
			await fs.createDirectory("/repo/weird.rogen.json");

			const result = await discovery.discover([]);

			expect(errorOf(result).message).toContain("No *.rogen.json found");
		});
	});

	describe("with names", () => {
		it("should resolve each name to <name>.rogen.json in order", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");
			await fs.writeFile("/repo/match.rogen.json", "{}");

			const result = await discovery.discover(["lobby", "match"]);

			expect(result.unwrap()).toEqual([
				"/repo/lobby.rogen.json",
				"/repo/match.rogen.json",
			]);
		});

		it("should fail as a usage error naming the path it looked for when a named config is missing", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");

			const result = await discovery.discover(["ghost"]);

			expect(errorOf(result)).toBeInstanceOf(UsageError);
			expect(errorOf(result).message).toContain("/repo/ghost.rogen.json");
		});

		it("should suggest the config a misspelled name is closest to", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");
			await fs.writeFile("/repo/match.rogen.json", "{}");

			const result = await discovery.discover(["lobyy"]);

			expect(errorOf(result).message).toBe(
				'Config "lobyy" not found: looked for /repo/lobyy.rogen.json. Did you mean "lobby"?'
			);
		});
	});

	describe("with paths", () => {
		it("should resolve a path relative to the working directory", async () => {
			await fs.createDirectory("/repo/places/lobby");
			await fs.writeFile("/repo/places/lobby/default.rogen.json", "{}");

			const result = await discovery.discover([
				"places/lobby/default.rogen.json",
			]);

			expect(result.unwrap()).toEqual([
				"/repo/places/lobby/default.rogen.json",
			]);
		});

		it("should mix with names, in the order given", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");
			await fs.writeFile("/repo/extra.rogen.json", "{}");

			const result = await discovery.discover([
				"extra.rogen.json",
				"lobby",
			]);

			expect(result.unwrap()).toEqual([
				"/repo/extra.rogen.json",
				"/repo/lobby.rogen.json",
			]);
		});

		it("should fail as a usage error naming a missing path, without a name lookup", async () => {
			await fs.writeFile("/repo/missing.rogen.json.rogen.json", "{}");

			const result = await discovery.discover(["missing.rogen.json"]);

			expect(errorOf(result)).toBeInstanceOf(UsageError);
			expect(errorOf(result).message).toBe(
				"Config file not found: /repo/missing.rogen.json"
			);
		});
	});

	describe("duplicates", () => {
		it("should fail when a name and a path resolve to the same file", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");

			const result = await discovery.discover([
				"lobby",
				"./lobby.rogen.json",
			]);

			expect(errorOf(result)).toBeInstanceOf(UsageError);
			expect(errorOf(result).message).toContain("/repo/lobby.rogen.json");
		});

		it("should fail when the same name is given twice", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");

			const result = await discovery.discover(["lobby", "lobby"]);

			expect(result.isErr()).toBe(true);
		});
	});
});
