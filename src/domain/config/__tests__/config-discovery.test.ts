import { ConfigDiscovery } from "../config-discovery.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ProjectError, UsageError } from "../../../base/errors.js";
import { Result, ResultError } from "../../../base/result.js";

function errorOf(result: Result<unknown, Error>): Error {
	return (result as ResultError<Error>).error;
}

describe("ConfigDiscovery", () => {
	let fs: MemoryFileSystemService;
	let discovery: ConfigDiscovery;
	const cwd = "/repo";

	const from = (directory: string) =>
		new ConfigDiscovery(fs, new MockEnvironmentService(directory));

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(cwd);
		discovery = from(cwd);
	});

	describe("with nothing named", () => {
		it("should resolve the default.rogen.json here", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");

			const found = (await discovery.discover([])).unwrap();

			expect(found).toEqual({
				home: "/repo",
				files: ["/repo/default.rogen.json"],
				noneNamed: true,
				scopes: new Map(),
				notes: [],
			});
		});

		it("should resolve a default.rogen.jsonc", async () => {
			await fs.writeFile("/repo/default.rogen.jsonc", "{}");

			expect((await discovery.discover([])).unwrap().files).toEqual([
				"/repo/default.rogen.jsonc",
			]);
		});

		it("should resolve the default and nothing else beside it", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/dist.rogen.json", "{}");
			await fs.writeFile("/repo/release.rogen.jsonc", "{}");

			expect((await discovery.discover([])).unwrap().files).toEqual([
				"/repo/default.rogen.json",
			]);
		});

		it("should prefer the default config to a plain default.project.json", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/default.project.json", "{}");

			expect((await discovery.discover([])).unwrap().files).toEqual([
				"/repo/default.rogen.json",
			]);
		});

		it("should fail, pointing at init, when there is none", async () => {
			const result = await discovery.discover([]);

			expect(errorOf(result).message).toBe(
				"No default.rogen.json or default.project.json in this folder (/repo). Run 'rogen init' to create one."
			);
			expect(errorOf(result)).toBeInstanceOf(ProjectError);
		});

		it("should name the other configs of the folder when there is no default", async () => {
			await fs.writeFile("/repo/dist.rogen.json", "{}");
			await fs.writeFile("/repo/release.rogen.jsonc", "{}");

			const result = await discovery.discover([]);

			expect(errorOf(result).message).toBe(
				"No default.rogen.json or default.project.json in this folder (/repo). It holds dist.rogen.json, release.rogen.jsonc. Name one of them, or run 'rogen init' to create default.rogen.json."
			);
		});

		it.each(["rogen.json", "rogen.jsonc"])(
			"should tell a folder holding only %s to rename it",
			async (name) => {
				await fs.writeFile(`/repo/${name}`, "{}");

				const result = await discovery.discover([]);

				expect(errorOf(result)).toBeInstanceOf(ProjectError);
				expect(errorOf(result).message).toBe(
					`${name} in /repo is not read any more: a config is named for the project file it writes. Rename it to default.rogen.json.`
				);
			}
		);

		it("should not search the folders above", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.createDirectory("/repo/src/Inventory");

			const result = await from("/repo/src/Inventory").discover([]);

			expect(errorOf(result).message).toContain(
				"No default.rogen.json or default.project.json in this folder"
			);
		});

		it("should not search the folders above for a plain project either", async () => {
			await fs.writeFile("/repo/default.project.json", "{}");
			await fs.createDirectory("/repo/src");

			const result = await from("/repo/src").discover([]);

			expect(result.isErr()).toBe(true);
		});

		it("should adopt the Rojo project file here when no config is here", async () => {
			await fs.writeFile("/repo/default.project.json", "{}");

			const found = (await discovery.discover([])).unwrap();

			expect(found.files).toEqual(["/repo/default.project.json"]);
		});

		it("should adopt default.project.jsonc when nothing else is there", async () => {
			await fs.writeFile("/repo/default.project.jsonc", "{}");

			const found = (await discovery.discover([])).unwrap();

			expect(found.files).toEqual(["/repo/default.project.jsonc"]);
		});

		it("should not take a project file of another name for the default", async () => {
			await fs.writeFile("/repo/test.project.json", "{}");

			const result = await discovery.discover([]);

			expect(result.isErr()).toBe(true);
		});

		it("should ignore a directory named like a config", async () => {
			await fs.createDirectory("/repo/default.rogen.json");

			const result = await discovery.discover([]);

			expect(result.isErr()).toBe(true);
		});

		it("should fail when the working directory can't be read", async () => {
			const result = await from("/nowhere").discover([]);

			expect(errorOf(result).message).toContain(
				"Could not look for a config file in /nowhere"
			);
		});

		it("should fail when both extensions of the default are here", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/default.rogen.jsonc", "{}");

			const result = await discovery.discover([]);

			expect(errorOf(result)).toBeInstanceOf(UsageError);
			expect(errorOf(result).message).toBe(
				"/repo holds both default.rogen.json and default.rogen.jsonc; keep one."
			);
		});

		it("should not mind both extensions of a stem it is not asked for", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/dist.rogen.json", "{}");
			await fs.writeFile("/repo/dist.rogen.jsonc", "{}");

			expect((await discovery.discover([])).unwrap().files).toEqual([
				"/repo/default.rogen.json",
			]);
		});
	});

	describe("with a file named in the working directory", () => {
		beforeEach(async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/dist.rogen.json", "{}");
		});

		it("should resolve a .rogen.json path to that file", async () => {
			const found = (
				await discovery.discover(["dist.rogen.json"])
			).unwrap();

			expect(found.files).toEqual(["/repo/dist.rogen.json"]);
		});

		it("should resolve a .rogen.jsonc file that is not the default", async () => {
			await fs.writeFile("/repo/release.rogen.jsonc", "{}");

			const found = (
				await discovery.discover(["release.rogen.jsonc"])
			).unwrap();

			expect(found.files).toEqual(["/repo/release.rogen.jsonc"]);
		});

		it("should resolve an X.project.json path to the X.rogen.json beside it", async () => {
			await fs.writeFile("/repo/dist.project.json", "{}");

			const found = (
				await discovery.discover(["dist.project.json"])
			).unwrap();

			expect(found.files).toEqual(["/repo/dist.rogen.json"]);
		});

		it("should resolve an X.project.json path that is not there to the X.rogen.json beside it", async () => {
			const found = (
				await discovery.discover(["dist.project.json"])
			).unwrap();

			expect(found.files).toEqual(["/repo/dist.rogen.json"]);
		});

		it("should resolve a bare name to its X.rogen.json", async () => {
			const found = (await discovery.discover(["dist"])).unwrap();

			expect(found.files).toEqual(["/repo/dist.rogen.json"]);
			expect(found.notes).toEqual([]);
		});

		it("should resolve a bare name to its X.rogen.jsonc", async () => {
			await fs.writeFile("/repo/release.rogen.jsonc", "{}");

			const found = (await discovery.discover(["release"])).unwrap();

			expect(found.files).toEqual(["/repo/release.rogen.jsonc"]);
		});

		it("should resolve a bare name to a plain X.project.json when no config has that name", async () => {
			await fs.writeFile("/repo/test.project.json", "{}");

			const found = (await discovery.discover(["test"])).unwrap();

			expect(found.files).toEqual(["/repo/test.project.json"]);
		});

		it("should prefer the config of a bare name to a plain project file", async () => {
			await fs.writeFile("/repo/dist.project.json", "{}");

			const found = (await discovery.discover(["dist"])).unwrap();

			expect(found.files).toEqual(["/repo/dist.rogen.json"]);
		});

		it("should resolve default to the default config", async () => {
			const found = (await discovery.discover(["default"])).unwrap();

			expect(found.files).toEqual(["/repo/default.rogen.json"]);
		});

		it("should take a plain X.project.json path beside a config of another name", async () => {
			await fs.writeFile("/repo/nested.project.json", "{}");

			const found = (
				await discovery.discover(["nested.project.json"])
			).unwrap();

			expect(found.files).toEqual(["/repo/nested.project.json"]);
		});

		it("should take a plain project file with comments that is named", async () => {
			await fs.writeFile("/repo/test.project.jsonc", "{}");

			const found = (
				await discovery.discover(["test.project.jsonc"])
			).unwrap();

			expect(found.files).toEqual(["/repo/test.project.jsonc"]);
		});

		it("should fail naming a project file that is not there and has no config", async () => {
			const result = await discovery.discover(["other.project.json"]);

			expect(errorOf(result).message).toContain(
				'"other.project.json" not found'
			);
		});

		it("should fail when both extensions of the stem named are here", async () => {
			await fs.writeFile("/repo/dist.rogen.jsonc", "{}");

			for (const ref of [
				"dist",
				"dist.rogen.json",
				"dist.project.json",
			]) {
				const result = await discovery.discover([ref]);

				expect(errorOf(result)).toBeInstanceOf(UsageError);
				expect(errorOf(result).message).toBe(
					"/repo holds both dist.rogen.json and dist.rogen.jsonc; keep one."
				);
			}
		});

		it("should say a folder wins over the file of the same name, and name the file", async () => {
			await fs.createDirectory("/repo/dist");
			await fs.writeFile("/repo/dist/default.rogen.json", "{}");

			const found = (await discovery.discover(["dist"])).unwrap();

			expect(found.files).toEqual(["/repo/dist/default.rogen.json"]);
			expect(found.notes).toEqual([
				'"dist" is a folder with a default config and also dist.rogen.json: using the folder. To use the file, name it: dist.rogen.json.',
			]);
		});

		it("should take the file of a bare name when the folder of that name holds no default", async () => {
			await fs.createDirectory("/repo/dist");

			const found = (await discovery.discover(["dist"])).unwrap();

			expect(found.files).toEqual(["/repo/dist.rogen.json"]);
			expect(found.notes).toEqual([]);
		});

		it("should say nothing of a folder that is not also a file", async () => {
			await fs.createDirectory("/repo/pkg");
			await fs.writeFile("/repo/pkg/default.rogen.json", "{}");

			const found = (await discovery.discover(["pkg"])).unwrap();

			expect(found.notes).toEqual([]);
		});

		it("should not let a path with a folder in it stand for a bare name", async () => {
			const result = await discovery.discover(["a/dist"]);

			expect(errorOf(result)).toBeInstanceOf(ProjectError);
		});
	});

	describe("with a folder holding other configs and no default", () => {
		it("should fail naming a folder with only an X.rogen.json", async () => {
			await fs.createDirectory("/repo/pkg");
			await fs.writeFile("/repo/pkg/dist.rogen.json", "{}");

			const result = await discovery.discover(["pkg"]);

			expect(errorOf(result).message).toBe(
				"No default.rogen.json or default.project.json in \"pkg\" (/repo/pkg). It holds dist.rogen.json. Name one of them, or run 'rogen init' to create default.rogen.json."
			);
		});
	});

	describe("every config of the folder", () => {
		it("should list each config file, with no default needed", async () => {
			await fs.writeFile("/repo/dist.rogen.json", "{}");
			await fs.writeFile("/repo/release.rogen.jsonc", "{}");
			await fs.writeFile("/repo/README.md", "");

			const found = (await discovery.discoverFolder()).unwrap();

			expect(found).toEqual({
				home: "/repo",
				files: ["/repo/dist.rogen.json", "/repo/release.rogen.jsonc"],
				noneNamed: false,
				scopes: new Map(),
				notes: [],
			});
		});

		it("should fall back to the default project file when there is no config", async () => {
			await fs.writeFile("/repo/default.project.json", "{}");

			const found = (await discovery.discoverFolder()).unwrap();

			expect(found.files).toEqual(["/repo/default.project.json"]);
		});

		it("should fail like a bare command when there is nothing", async () => {
			const result = await discovery.discoverFolder();

			expect(errorOf(result).message).toContain(
				"No default.rogen.json or default.project.json in this folder"
			);
		});

		it("should fail when a stem has both extensions", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/dist.rogen.json", "{}");
			await fs.writeFile("/repo/dist.rogen.jsonc", "{}");

			const result = await discovery.discoverFolder();

			expect(errorOf(result).message).toBe(
				"/repo holds both dist.rogen.json and dist.rogen.jsonc; keep one."
			);
		});
	});

	describe("with configs named", () => {
		beforeEach(async () => {
			await fs.createDirectory("/repo/places/lobby");
			await fs.writeFile("/repo/places/lobby/default.rogen.json", "{}");
		});

		it("should resolve a folder to its config", async () => {
			const found = (await discovery.discover(["places/lobby"])).unwrap();

			expect(found).toEqual({
				home: "/repo",
				files: ["/repo/places/lobby/default.rogen.json"],
				noneNamed: false,
				scopes: new Map(),
				notes: [],
			});
		});

		it("should resolve an absolute folder", async () => {
			const found = (
				await discovery.discover(["/repo/places/lobby"])
			).unwrap();

			expect(found.files).toEqual([
				"/repo/places/lobby/default.rogen.json",
			]);
		});

		it("should resolve a default.project.json path to the config of its folder", async () => {
			const found = (
				await discovery.discover(["places/lobby/default.project.json"])
			).unwrap();

			expect(found.files).toEqual([
				"/repo/places/lobby/default.rogen.json",
			]);
		});

		it("should resolve a path to the config file itself", async () => {
			const found = (
				await discovery.discover(["places/lobby/default.rogen.json"])
			).unwrap();

			expect(found.files).toEqual([
				"/repo/places/lobby/default.rogen.json",
			]);
		});

		it("should resolve each in the order given", async () => {
			await fs.createDirectory("/repo/places/arena");
			await fs.writeFile("/repo/places/arena/default.rogen.json", "{}");

			const found = (
				await discovery.discover(["places/lobby", "places/arena"])
			).unwrap();

			expect(found.files).toEqual([
				"/repo/places/lobby/default.rogen.json",
				"/repo/places/arena/default.rogen.json",
			]);
		});

		it("should fail as a project error, pointing at init, for a folder with no config", async () => {
			await fs.createDirectory("/repo/places/arena");

			const result = await discovery.discover(["places/arena"]);

			expect(errorOf(result)).toBeInstanceOf(ProjectError);
			expect(errorOf(result).message).toBe(
				`No default.rogen.json or default.project.json in "places/arena" (/repo/places/arena). Run 'rogen init' to create one.`
			);
		});

		it("should fail for a project file in a folder with no config", async () => {
			await fs.createDirectory("/repo/places/arena");

			const result = await discovery.discover([
				"places/arena/default.project.json",
			]);

			expect(errorOf(result)).toBeInstanceOf(ProjectError);
		});

		it("should fail as a project error naming a path that is not there", async () => {
			const result = await discovery.discover(["places/nowhere"]);

			expect(errorOf(result)).toBeInstanceOf(ProjectError);
			expect(errorOf(result).message).toBe(
				`"places/nowhere" not found. Name a folder with a default.rogen.json, a .rogen.json file, or a *.project.json path.`
			);
		});

		it("should say a folder named twice was named twice", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");

			const result = await discovery.discover([".", "."]);

			expect(errorOf(result).message).toContain(
				"was named more than once"
			);
		});

		describe("a bare name", () => {
			beforeEach(async () => {
				await fs.writeFile("/repo/default.rogen.json", "{}");
			});

			it("should be the folder when a folder with a default.rogen.json has that name", async () => {
				await fs.createDirectory("/repo/dist");
				await fs.writeFile("/repo/dist/default.rogen.json", "{}");

				const found = (await discovery.discover(["dist"])).unwrap();

				expect(found.files).toEqual(["/repo/dist/default.rogen.json"]);
			});

			it("should adopt a folder that holds only a default.project.json", async () => {
				await fs.createDirectory("/repo/dist");
				await fs.writeFile("/repo/dist/default.project.json", "{}");

				const found = (await discovery.discover(["dist"])).unwrap();

				expect(found.files).toEqual([
					"/repo/dist/default.project.json",
				]);
			});

			it("should fail as not found when no folder has that name", async () => {
				const result = await discovery.discover(["dist"]);

				expect(errorOf(result)).toBeInstanceOf(ProjectError);
				expect(errorOf(result).message).toContain("not found");
			});

			it("should not be taken for a project when it has a path in it", async () => {
				const result = await discovery.discover(["a/dist"]);

				expect(errorOf(result)).toBeInstanceOf(ProjectError);
			});
		});

		it("should fail for a file that is neither", async () => {
			await fs.writeFile("/repo/README.md", "");

			const result = await discovery.discover(["README.md"]);

			expect(errorOf(result).message).toBe(
				`"README.md" is not a folder with a default.rogen.json, a .rogen.json file, nor a *.project.json path.`
			);
		});

		it("should fail when the same config is named twice", async () => {
			const result = await discovery.discover([
				"places/lobby",
				"places/lobby/default.rogen.json",
			]);

			expect(errorOf(result).message).toContain(
				"was named more than once"
			);
		});

		it("should take the working directory for home", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.createDirectory("/repo/tools");

			const found = (
				await from("/repo/tools").discover(["../places/lobby"])
			).unwrap();

			expect(found.home).toBe("/repo/tools");
			expect(found.files).toEqual([
				"/repo/places/lobby/default.rogen.json",
			]);
		});
	});
});

describe("ConfigDiscovery.findEnclosing", () => {
	let fs: MemoryFileSystemService;

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		await fs.createDirectory("/repo/src");
		await fs.createDirectory("/repo/src/Inventory");
	});

	const from = (cwd: string) =>
		new ConfigDiscovery(fs, new MockEnvironmentService(cwd));

	describe("places", () => {
		beforeEach(async () => {
			await fs.writeFile(
				"/repo/default.rogen.json",
				JSON.stringify({ placePaths: ["places/*"] })
			);
			await fs.createDirectory("/repo/places/lobby/src");
			await fs.createDirectory("/repo/places/arena");
			await fs.writeFile("/repo/places/arena/default.rogen.json", "{}");
			await fs.createDirectory("/repo/tools");
			await fs.writeFile("/repo/tools/default.rogen.json", "{}");
		});

		it("should read the whole root from the root", async () => {
			const found = (await from("/repo").discover([])).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/default.rogen.json"],
				scopes: new Map(),
				noneNamed: true,
			});
		});

		it("should scope to a place without a config of its own from inside it", async () => {
			const found = (
				await from("/repo/places/lobby/src").discover([])
			).unwrap();

			expect(found).toMatchObject({
				home: "/repo/places/lobby",
				files: ["/repo/default.rogen.json"],
				noneNamed: false,
				scopes: new Map([
					["/repo/default.rogen.json", ["/repo/places/lobby"]],
				]),
			});
		});

		it("should scope to a place with a config of its own from its folder", async () => {
			const found = (
				await from("/repo/places/arena").discover([])
			).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/default.rogen.json"],
				scopes: new Map([
					["/repo/default.rogen.json", ["/repo/places/arena"]],
				]),
			});
		});

		it("should read a config that no root lists as its own", async () => {
			const found = (await from("/repo/tools").discover([])).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/tools/default.rogen.json"],
				scopes: new Map(),
			});
		});

		it("should resolve a place folder without a config to the config that lists it", async () => {
			const found = (
				await from("/repo").discover(["places/lobby"])
			).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/default.rogen.json"],
				scopes: new Map([
					["/repo/default.rogen.json", ["/repo/places/lobby"]],
				]),
			});
		});

		it("should resolve a place's default.project.json to that place", async () => {
			const found = (
				await from("/repo").discover([
					"places/arena/default.project.json",
				])
			).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/default.rogen.json"],
				scopes: new Map([
					["/repo/default.rogen.json", ["/repo/places/arena"]],
				]),
			});
		});

		it("should resolve a place's config file", async () => {
			const found = (
				await from("/repo").discover([
					"places/arena/default.rogen.json",
				])
			).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/default.rogen.json"],
				scopes: new Map([
					["/repo/default.rogen.json", ["/repo/places/arena"]],
				]),
			});
		});

		it("should join the places named into one scope", async () => {
			const found = (
				await from("/repo").discover(["places/lobby", "places/arena"])
			).unwrap();

			expect(found.files).toEqual(["/repo/default.rogen.json"]);
			expect(found.scopes.get("/repo/default.rogen.json")).toEqual([
				"/repo/places/lobby",
				"/repo/places/arena",
			]);
		});

		it("should refuse the same place named twice", async () => {
			const result = await from("/repo").discover([
				"places/lobby",
				"places/lobby",
			]);

			expect(errorOf(result).message).toMatch(/named more than once/);
		});

		it("should refuse a place and the whole config named together", async () => {
			const result = await from("/repo").discover([".", "places/lobby"]);

			expect(errorOf(result).message).toMatch(/named more than once/);
		});

		it("should take the bare name of a listed place that has no config for the place", async () => {
			const found = (
				await from("/repo/places").discover(["lobby"])
			).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/default.rogen.json"],
				scopes: new Map([
					["/repo/default.rogen.json", ["/repo/places/lobby"]],
				]),
			});
		});
	});

	it("should find the nearest parent folder with a config", async () => {
		await fs.writeFile("/repo/default.rogen.json", "{}");
		await fs.writeFile("/repo/src/default.rogen.jsonc", "{}");

		const found = await from("/repo/src/Inventory").findEnclosing();

		expect(found).toEqual({
			directory: "/repo/src",
			fileNames: ["default.rogen.jsonc"],
		});
	});

	it("should not count the working directory", async () => {
		await fs.writeFile("/repo/default.rogen.json", "{}");

		expect(await from("/repo").findEnclosing()).toBeUndefined();
	});

	it("should find nothing when no parent has a config", async () => {
		expect(
			await from("/repo/src/Inventory").findEnclosing()
		).toBeUndefined();
	});

	it("should go on past a parent that can't be read", async () => {
		await fs.writeFile("/default.rogen.json", "{}");

		const found = await from("/missing/child").findEnclosing();

		expect(found).toEqual({
			directory: "/",
			fileNames: ["default.rogen.json"],
		});
	});
});
