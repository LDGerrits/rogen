import { ConfigDiscovery } from "../config-discovery.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { UsageError } from "../../../base/errors.js";
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
		it("should resolve the rogen.json here", async () => {
			await fs.writeFile("/repo/rogen.json", "{}");

			const found = (await discovery.discover([])).unwrap();

			expect(found).toEqual({
				home: "/repo",
				files: ["/repo/rogen.json"],
				noneNamed: true,
				projects: new Map(),
				folders: [],
				homeConfig: "/repo/rogen.json",
				scopes: new Map(),
			});
		});

		it("should resolve a rogen.jsonc", async () => {
			await fs.writeFile("/repo/rogen.jsonc", "{}");

			expect((await discovery.discover([])).unwrap().files).toEqual([
				"/repo/rogen.jsonc",
			]);
		});

		it("should fail, pointing at init, when there is none", async () => {
			const result = await discovery.discover([]);

			expect(errorOf(result).message).toBe(
				"No rogen.json found in /repo. Run 'rogen init' to create one."
			);
			expect(errorOf(result)).not.toBeInstanceOf(UsageError);
		});

		it("should adopt the Rojo project file here when no folder holds a config", async () => {
			await fs.writeFile("/repo/default.project.json", "{}");

			const found = (await discovery.discover([])).unwrap();

			expect(found.files).toEqual(["/repo/default.project.json"]);
			expect(found.homeConfig).toBe("/repo/default.project.json");
		});

		it("should adopt the Rojo project file of the nearest folder above", async () => {
			await fs.writeFile("/repo/default.project.json", "{}");
			await fs.createDirectory("/repo/src");

			const found = (await from("/repo/src").discover([])).unwrap();

			expect(found.files).toEqual(["/repo/default.project.json"]);
		});

		it("should prefer a config above to a Rojo project file here", async () => {
			await fs.writeFile("/repo/rogen.json", "{}");
			await fs.createDirectory("/repo/lib");
			await fs.writeFile("/repo/lib/default.project.json", "{}");

			const found = (await from("/repo/lib").discover([])).unwrap();

			expect(found.files).toEqual(["/repo/rogen.json"]);
		});

		it("should adopt the Rojo project file of a folder that is named", async () => {
			await fs.createDirectory("/repo/pkg");
			await fs.writeFile("/repo/pkg/default.project.json", "{}");

			const found = (await discovery.discover(["pkg"])).unwrap();

			expect(found.files).toEqual(["/repo/pkg/default.project.json"]);
		});

		it("should use the config of the nearest folder above when this one has none", async () => {
			await fs.createDirectory("/repo/src/Inventory");
			await fs.writeFile("/repo/rogen.json", "{}");

			const found = (
				await from("/repo/src/Inventory").discover([])
			).unwrap();

			expect(found.home).toBe("/repo");
			expect(found.files).toEqual(["/repo/rogen.json"]);
		});

		it("should prefer the config here over those above", async () => {
			await fs.createDirectory("/repo/places");
			await fs.writeFile("/repo/rogen.json", "{}");
			await fs.writeFile("/repo/places/rogen.json", "{}");

			const found = (await from("/repo/places").discover([])).unwrap();

			expect(found.home).toBe("/repo/places");
			expect(found.files).toEqual(["/repo/places/rogen.json"]);
		});

		it("should fail when no folder above has one either", async () => {
			await fs.createDirectory("/repo/src");

			const result = await from("/repo/src").discover([]);

			expect(errorOf(result).message).toContain("No rogen.json found");
		});

		it("should ignore a directory named like a config", async () => {
			await fs.createDirectory("/repo/rogen.json");

			const result = await discovery.discover([]);

			expect(result.isErr()).toBe(true);
		});

		it("should fail when the working directory can't be read", async () => {
			const result = await from("/nowhere").discover([]);

			expect(errorOf(result).message).toContain(
				"Could not look for a config file in /nowhere"
			);
		});

		it("should fail when both names are here", async () => {
			await fs.writeFile("/repo/rogen.json", "{}");
			await fs.writeFile("/repo/rogen.jsonc", "{}");

			const result = await discovery.discover([]);

			expect(errorOf(result)).toBeInstanceOf(UsageError);
			expect(errorOf(result).message).toBe(
				"/repo holds both rogen.json and rogen.jsonc; keep one."
			);
		});
	});

	describe("with projects named", () => {
		beforeEach(async () => {
			await fs.createDirectory("/repo/places/lobby");
			await fs.writeFile("/repo/places/lobby/rogen.json", "{}");
		});

		it("should resolve a folder to its config", async () => {
			const found = (await discovery.discover(["places/lobby"])).unwrap();

			expect(found).toEqual({
				home: "/repo",
				files: ["/repo/places/lobby/rogen.json"],
				noneNamed: false,
				projects: new Map(),
				folders: [],
				homeConfig: undefined,
				scopes: new Map(),
			});
		});

		it("should resolve an absolute folder", async () => {
			const found = (
				await discovery.discover(["/repo/places/lobby"])
			).unwrap();

			expect(found.files).toEqual(["/repo/places/lobby/rogen.json"]);
		});

		it("should resolve a default.project.json path to the config of its folder", async () => {
			const found = (
				await discovery.discover(["places/lobby/default.project.json"])
			).unwrap();

			expect(found.files).toEqual(["/repo/places/lobby/rogen.json"]);
		});

		it("should resolve a path to the config file itself", async () => {
			const found = (
				await discovery.discover(["places/lobby/rogen.json"])
			).unwrap();

			expect(found.files).toEqual(["/repo/places/lobby/rogen.json"]);
		});

		it("should resolve each in the order given", async () => {
			await fs.createDirectory("/repo/places/arena");
			await fs.writeFile("/repo/places/arena/rogen.json", "{}");

			const found = (
				await discovery.discover(["places/lobby", "places/arena"])
			).unwrap();

			expect(found.files).toEqual([
				"/repo/places/lobby/rogen.json",
				"/repo/places/arena/rogen.json",
			]);
		});

		it("should fail as a usage error, pointing at init, for a folder with no config", async () => {
			await fs.createDirectory("/repo/places/arena");

			const result = await discovery.discover(["places/arena"]);

			expect(errorOf(result)).toBeInstanceOf(UsageError);
			expect(errorOf(result).message).toBe(
				`"places/arena" holds no rogen.json (/repo/places/arena). Run 'rogen init' to create one.`
			);
		});

		it("should name the project a *.project.json path stands for", async () => {
			const found = (
				await discovery.discover(["places/lobby/dist.project.json"])
			).unwrap();

			expect(found.files).toEqual(["/repo/places/lobby/rogen.json"]);
			expect(found.projects).toEqual(
				new Map([
					[
						"/repo/places/lobby/rogen.json",
						{ names: ["dist"], usual: false },
					],
				])
			);
		});

		it("should name no project for default.project.json, which is the description", async () => {
			const found = (
				await discovery.discover(["places/lobby/default.project.json"])
			).unwrap();

			expect(found.projects).toEqual(new Map());
		});

		it("should fail for a project file in a folder with no config", async () => {
			await fs.createDirectory("/repo/places/arena");

			const result = await discovery.discover([
				"places/arena/default.project.json",
			]);

			expect(errorOf(result)).toBeInstanceOf(UsageError);
		});

		it("should fail as a usage error naming a path that is not there", async () => {
			const result = await discovery.discover(["places/nowhere"]);

			expect(errorOf(result)).toBeInstanceOf(UsageError);
			expect(errorOf(result).message).toBe(
				`"places/nowhere" not found. Name a folder with a rogen.json, a *.project.json path, or a project of the rogen.json here.`
			);
		});

		it("should hold every project of one config that is named", async () => {
			await fs.writeFile("/repo/rogen.json", "{}");

			const found = (
				await discovery.discover(["dist", "release.project.json"])
			).unwrap();

			expect(found.files).toEqual(["/repo/rogen.json"]);
			expect(found.projects).toEqual(
				new Map([
					[
						"/repo/rogen.json",
						{ names: ["dist", "release"], usual: false },
					],
				])
			);
		});

		it("should hold a project named beside its config, and the config's own project too", async () => {
			await fs.writeFile("/repo/rogen.json", "{}");

			const found = (await discovery.discover([".", "dist"])).unwrap();

			expect(found.projects).toEqual(
				new Map([
					["/repo/rogen.json", { names: ["dist"], usual: true }],
				])
			);
		});

		it("should still say a project named twice was named twice", async () => {
			await fs.writeFile("/repo/rogen.json", "{}");

			const result = await discovery.discover(["dist", "dist"]);

			expect(errorOf(result).message).toContain(
				"was named more than once"
			);
		});

		describe("a bare name", () => {
			beforeEach(async () => {
				await fs.writeFile("/repo/rogen.json", "{}");
			});

			it("should be a project of the config here when nothing by that name exists", async () => {
				const found = (await discovery.discover(["dist"])).unwrap();

				expect(found.files).toEqual(["/repo/rogen.json"]);
				expect(found.projects).toEqual(
					new Map([
						["/repo/rogen.json", { names: ["dist"], usual: false }],
					])
				);
				expect(found.folders).toEqual([]);
			});

			it("should be a project of the config found above when the working directory has none", async () => {
				await fs.createDirectory("/repo/tools");

				const found = (
					await from("/repo/tools").discover(["dist"])
				).unwrap();

				expect(found.files).toEqual(["/repo/rogen.json"]);
				expect(found.projects).toEqual(
					new Map([
						["/repo/rogen.json", { names: ["dist"], usual: false }],
					])
				);
			});

			it("should be the folder when a folder with a rogen.json has that name, and say so", async () => {
				await fs.createDirectory("/repo/dist");
				await fs.writeFile("/repo/dist/rogen.json", "{}");

				const found = (await discovery.discover(["dist"])).unwrap();

				expect(found.files).toEqual(["/repo/dist/rogen.json"]);
				expect(found.projects).toEqual(new Map());
				expect(found.folders).toEqual(["dist"]);
			});

			it("should fail for a folder that holds only a default.project.json, which counts as a folder", async () => {
				await fs.createDirectory("/repo/dist");
				await fs.writeFile("/repo/dist/default.project.json", "{}");

				const result = await discovery.discover(["dist"]);

				expect(errorOf(result).message).toContain(
					"holds no rogen.json"
				);
			});

			it("should be a project when a folder of that name holds no config", async () => {
				await fs.createDirectory("/repo/dist");
				await fs.writeFile("/repo/dist/Main.luau", "");

				const found = (await discovery.discover(["dist"])).unwrap();

				expect(found.files).toEqual(["/repo/rogen.json"]);
				expect(found.projects).toEqual(
					new Map([
						["/repo/rogen.json", { names: ["dist"], usual: false }],
					])
				);
			});

			it("should not be taken for a project when it has a path in it", async () => {
				const result = await discovery.discover(["a/dist"]);

				expect(errorOf(result)).toBeInstanceOf(UsageError);
			});

			it("should fail as not found when there is no config to hold the project", async () => {
				await fs.delete("/repo/rogen.json");

				const result = await discovery.discover(["dist"]);

				expect(errorOf(result).message).toContain("not found");
			});
		});

		it("should fail for a file that is neither", async () => {
			await fs.writeFile("/repo/README.md", "");

			const result = await discovery.discover(["README.md"]);

			expect(errorOf(result).message).toBe(
				`"README.md" is not a folder with a rogen.json, nor a *.project.json path.`
			);
		});

		it("should fail when the same config is named twice", async () => {
			const result = await discovery.discover([
				"places/lobby",
				"places/lobby/rogen.json",
			]);

			expect(errorOf(result).message).toContain(
				"was named more than once"
			);
		});

		it("should take the folder found for home when the working directory has no config", async () => {
			await fs.writeFile("/repo/rogen.json", "{}");
			await fs.createDirectory("/repo/tools");

			const found = (
				await from("/repo/tools").discover(["../places/lobby"])
			).unwrap();

			expect(found.home).toBe("/repo");
			expect(found.files).toEqual(["/repo/places/lobby/rogen.json"]);
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
				"/repo/rogen.json",
				JSON.stringify({ placePaths: ["places/*"] })
			);
			await fs.createDirectory("/repo/places/lobby/src");
			await fs.createDirectory("/repo/places/arena");
			await fs.writeFile("/repo/places/arena/rogen.json", "{}");
			await fs.createDirectory("/repo/tools");
			await fs.writeFile("/repo/tools/rogen.json", "{}");
		});

		it("should read the whole root from the root", async () => {
			const found = (await from("/repo").discover([])).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/rogen.json"],
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
				files: ["/repo/rogen.json"],
				homeConfig: "/repo/rogen.json",
				noneNamed: false,
				scopes: new Map([["/repo/rogen.json", ["/repo/places/lobby"]]]),
			});
		});

		it("should scope to a place with a config of its own from its folder", async () => {
			const found = (
				await from("/repo/places/arena").discover([])
			).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/rogen.json"],
				scopes: new Map([["/repo/rogen.json", ["/repo/places/arena"]]]),
			});
		});

		it("should read a config that no root lists as its own", async () => {
			const found = (await from("/repo/tools").discover([])).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/tools/rogen.json"],
				scopes: new Map(),
			});
		});

		it("should resolve a place folder without a config to the config that lists it", async () => {
			const found = (
				await from("/repo").discover(["places/lobby"])
			).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/rogen.json"],
				scopes: new Map([["/repo/rogen.json", ["/repo/places/lobby"]]]),
			});
		});

		it("should resolve a place's project file to the project of that place", async () => {
			const found = (
				await from("/repo").discover([
					"places/arena/release.project.json",
				])
			).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/rogen.json"],
				projects: new Map([
					["/repo/rogen.json", { names: ["release"], usual: false }],
				]),
				scopes: new Map([["/repo/rogen.json", ["/repo/places/arena"]]]),
			});
		});

		it("should resolve a place's config file", async () => {
			const found = (
				await from("/repo").discover(["places/arena/rogen.json"])
			).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/rogen.json"],
				scopes: new Map([["/repo/rogen.json", ["/repo/places/arena"]]]),
			});
		});

		it("should join the places named into one scope", async () => {
			const found = (
				await from("/repo").discover(["places/lobby", "places/arena"])
			).unwrap();

			expect(found.files).toEqual(["/repo/rogen.json"]);
			expect(found.scopes.get("/repo/rogen.json")).toEqual([
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

		it("should refuse two places named for different projects", async () => {
			const result = await from("/repo").discover([
				"places/lobby/a.project.json",
				"places/arena/b.project.json",
			]);

			expect(errorOf(result).message).toMatch(
				/name different projects of one config/
			);
		});

		it("should hold a place and a project of that place named together", async () => {
			const found = (
				await from("/repo").discover([
					"places/lobby",
					"places/lobby/test.project.json",
				])
			).unwrap();

			expect(found.projects).toEqual(
				new Map([
					["/repo/rogen.json", { names: ["test"], usual: true }],
				])
			);
			expect(found.scopes).toEqual(
				new Map([["/repo/rogen.json", ["/repo/places/lobby"]]])
			);
		});

		it("should take the bare name of a listed place that has no config for the place", async () => {
			const found = (
				await from("/repo/places").discover(["lobby"])
			).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/rogen.json"],
				folders: ["lobby"],
				scopes: new Map([["/repo/rogen.json", ["/repo/places/lobby"]]]),
			});
			expect(found.projects.size).toBe(0);
		});

		it("should scope a project named from inside a place to that place", async () => {
			const found = (
				await from("/repo/places/lobby").discover(["release"])
			).unwrap();

			expect(found.scopes).toEqual(
				new Map([["/repo/rogen.json", ["/repo/places/lobby"]]])
			);
		});

		it("should read a bare name from inside a place as a project of the listing config", async () => {
			const found = (
				await from("/repo/places/lobby").discover(["release"])
			).unwrap();

			expect(found).toMatchObject({
				files: ["/repo/rogen.json"],
				homeConfig: "/repo/rogen.json",
				projects: new Map([
					["/repo/rogen.json", { names: ["release"], usual: false }],
				]),
			});
		});
	});

	it("should find the nearest parent folder with a config", async () => {
		await fs.writeFile("/repo/rogen.json", "{}");
		await fs.writeFile("/repo/src/rogen.jsonc", "{}");

		const found = await from("/repo/src/Inventory").findEnclosing();

		expect(found).toEqual({
			directory: "/repo/src",
			fileNames: ["rogen.jsonc"],
		});
	});

	it("should not count the working directory", async () => {
		await fs.writeFile("/repo/rogen.json", "{}");

		expect(await from("/repo").findEnclosing()).toBeUndefined();
	});

	it("should find nothing when no parent has a config", async () => {
		expect(
			await from("/repo/src/Inventory").findEnclosing()
		).toBeUndefined();
	});

	it("should go on past a parent that can't be read", async () => {
		await fs.writeFile("/rogen.json", "{}");

		const found = await from("/missing/child").findEnclosing();

		expect(found).toEqual({
			directory: "/",
			fileNames: ["rogen.json"],
		});
	});
});
