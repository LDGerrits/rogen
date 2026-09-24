import { discoverConfigPaths } from "../config-discovery.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { Result, ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";

function diagnosticsOf(result: Result<unknown, Diagnostic[]>): Diagnostic[] {
	return (result as ResultError<Diagnostic[]>).error;
}

describe("discoverConfigPaths", () => {
	let fs: MemoryFileSystemService;
	const cwd = "/repo";

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(cwd);
	});

	describe("with no names and no explicit paths", () => {
		it("resolves to default.rogen.json when it exists", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/other.rogen.json", "{}");

			const result = await discoverConfigPaths(fs, cwd, []);

			expect(result.isOk()).toBe(true);
			expect(result.unwrap()).toEqual(["/repo/default.rogen.json"]);
		});

		it("resolves to the single *.rogen.json present", async () => {
			await fs.writeFile("/repo/staging.rogen.json", "{}");

			const result = await discoverConfigPaths(fs, cwd, []);

			expect(result.unwrap()).toEqual(["/repo/staging.rogen.json"]);
		});

		it("errors, listing every candidate, when several exist and none is default", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");
			await fs.writeFile("/repo/match.rogen.json", "{}");

			const result = await discoverConfigPaths(fs, cwd, []);

			expect(result.isErr()).toBe(true);
			expect(result.unwrapOr(undefined)).toBeUndefined();
			const [diagnostic] = diagnosticsOf(result);
			expect(diagnostic.code).toBe("config.ambiguous");
			expect(diagnostic.message).toContain("lobby.rogen.json");
			expect(diagnostic.message).toContain("match.rogen.json");
		});

		it("errors clearly when nothing is found", async () => {
			const result = await discoverConfigPaths(fs, cwd, []);

			expect(result.isErr()).toBe(true);
			expect(diagnosticsOf(result)).toMatchObject([
				{ code: "config.noneFound", resource: cwd },
			]);
		});

		it("ignores a directory that happens to end in .rogen.json", async () => {
			await fs.createDirectory("/repo/weird.rogen.json");

			const result = await discoverConfigPaths(fs, cwd, []);

			expect(result.isErr()).toBe(true);
			expect(diagnosticsOf(result)).toMatchObject([
				{ code: "config.noneFound", resource: cwd },
			]);
		});
	});

	describe("with positional names", () => {
		it("resolves each name to <name>.rogen.json in order", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");
			await fs.writeFile("/repo/match.rogen.json", "{}");

			const result = await discoverConfigPaths(fs, cwd, [
				"lobby",
				"match",
			]);

			expect(result.unwrap()).toEqual([
				"/repo/lobby.rogen.json",
				"/repo/match.rogen.json",
			]);
		});

		it("does not fall back to a default when names are given", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");

			const result = await discoverConfigPaths(fs, cwd, ["lobby"]);

			expect(result.isErr()).toBe(true);
		});

		it("errors naming the path it looked for when a named config is missing", async () => {
			const result = await discoverConfigPaths(fs, cwd, ["ghost"]);

			expect(result.isErr()).toBe(true);
			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "config.namedNotFound",
					resource: "/repo/ghost.rogen.json",
				},
			]);
		});
	});

	describe("with -c paths", () => {
		it("resolves an explicit path relative to cwd", async () => {
			await fs.createDirectory("/repo/places/lobby");
			await fs.writeFile("/repo/places/lobby/default.rogen.json", "{}");

			const result = await discoverConfigPaths(
				fs,
				cwd,
				[],
				["places/lobby/default.rogen.json"]
			);

			expect(result.unwrap()).toEqual([
				"/repo/places/lobby/default.rogen.json",
			]);
		});

		it("is repeatable", async () => {
			await fs.writeFile("/repo/a.rogen.json", "{}");
			await fs.writeFile("/repo/b.rogen.json", "{}");

			const result = await discoverConfigPaths(
				fs,
				cwd,
				[],
				["a.rogen.json", "b.rogen.json"]
			);

			expect(result.unwrap()).toEqual([
				"/repo/a.rogen.json",
				"/repo/b.rogen.json",
			]);
		});

		it("composes with positional names, names first", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");
			await fs.writeFile("/repo/extra.rogen.json", "{}");

			const result = await discoverConfigPaths(
				fs,
				cwd,
				["lobby"],
				["extra.rogen.json"]
			);

			expect(result.unwrap()).toEqual([
				"/repo/lobby.rogen.json",
				"/repo/extra.rogen.json",
			]);
		});

		it("errors naming the path when a -c path is missing", async () => {
			const result = await discoverConfigPaths(
				fs,
				cwd,
				[],
				["missing.rogen.json"]
			);

			expect(result.isErr()).toBe(true);
			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "config.pathNotFound",
					resource: "/repo/missing.rogen.json",
				},
			]);
		});
	});

	describe("duplicates", () => {
		it("errors when a name and a -c path resolve to the same file", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");

			const result = await discoverConfigPaths(
				fs,
				cwd,
				["lobby"],
				["lobby.rogen.json"]
			);

			expect(result.isErr()).toBe(true);
			expect(diagnosticsOf(result)).toMatchObject([
				{
					code: "config.duplicate",
					resource: "/repo/lobby.rogen.json",
				},
			]);
		});

		it("errors when the same name is given twice", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");

			const result = await discoverConfigPaths(fs, cwd, [
				"lobby",
				"lobby",
			]);

			expect(diagnosticsOf(result)).toMatchObject([
				{ code: "config.duplicate" },
			]);
		});
	});
});
