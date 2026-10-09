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

			expect(result.unwrap().files).toEqual([
				"/repo/default.rogen.json",
				"/repo/lobby.rogen.json",
				"/repo/match.rogen.json",
			]);
		});

		it("should not need a default config", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");
			await fs.writeFile("/repo/match.rogen.json", "{}");

			const result = await discovery.discover([]);

			expect(result.unwrap().files).toEqual([
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

		it("should use the configs of the nearest folder above when this one has none", async () => {
			await fs.createDirectory("/repo/src/Inventory");
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/lobby.rogen.json", "{}");
			const nested = new ConfigDiscovery(
				fs,
				new MockEnvironmentService("/repo/src/Inventory")
			);

			const result = await nested.discover([]);

			expect(result.unwrap()).toEqual({
				directory: "/repo",
				files: ["/repo/default.rogen.json", "/repo/lobby.rogen.json"],
				everyConfig: true,
				separate: [],
				folders: ["/repo", "/repo/src", "/repo/src/Inventory"],
			});
		});

		it("should prefer the configs here over those above", async () => {
			await fs.createDirectory("/repo/places");
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/places/lobby.rogen.json", "{}");
			const nested = new ConfigDiscovery(
				fs,
				new MockEnvironmentService("/repo/places")
			);

			const result = await nested.discover([]);

			expect(result.unwrap().files).toEqual([
				"/repo/places/lobby.rogen.json",
			]);
		});

		it("should fail, pointing at init, when no folder above has one either", async () => {
			await fs.createDirectory("/repo/src");
			const nested = new ConfigDiscovery(
				fs,
				new MockEnvironmentService("/repo/src")
			);

			const result = await nested.discover([]);

			expect(errorOf(result).message).toBe(
				'No *.rogen.json found in /repo/src. Run "rogen init" to create one.'
			);
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

			expect(result.unwrap().files).toEqual([
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

		it("should list the configs there when no name is close", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/place-lobby.rogen.json", "{}");

			const result = await discovery.discover(["xyz"]);

			expect(errorOf(result).message).toBe(
				'Config "xyz" not found: looked for /repo/xyz.rogen.json. Configs here: default, place-lobby.'
			);
		});

		it("should point at init when there are no configs at all", async () => {
			const result = await discovery.discover(["ghost"]);

			expect(errorOf(result).message).toBe(
				'Config "ghost" not found: looked for /repo/ghost.rogen.json. Run "rogen init" to create one.'
			);
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

	describe("from a subfolder", () => {
		let nested: ConfigDiscovery;

		beforeEach(async () => {
			await fs.createDirectory("/repo/src");
			await fs.writeFile("/repo/lobby.rogen.json", "{}");
			await fs.createDirectory("/repo/places");
			await fs.writeFile("/repo/places/match.rogen.json", "{}");
			nested = new ConfigDiscovery(
				fs,
				new MockEnvironmentService("/repo/src")
			);
		});

		it("should resolve a name in the folder found", async () => {
			const result = await nested.discover(["lobby"]);

			expect(result.unwrap()).toEqual({
				directory: "/repo",
				files: ["/repo/lobby.rogen.json"],
				everyConfig: false,
				separate: [],
				folders: [],
			});
		});

		it("should resolve a path from the working directory", async () => {
			const result = await nested.discover([
				"../places/match.rogen.json",
			]);

			expect(result.unwrap().files).toEqual([
				"/repo/places/match.rogen.json",
			]);
		});

		it("should list the configs of the folder found when a name is missing", async () => {
			const result = await nested.discover(["ghost"]);

			expect(errorOf(result).message).toBe(
				'Config "ghost" not found: looked for /repo/ghost.rogen.json. Configs here: lobby.'
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

			expect(result.unwrap().files).toEqual([
				"/repo/places/lobby/default.rogen.json",
			]);
		});

		it.each([
			"places/lobby.rogen.json",
			"places\\lobby.rogen.json",
			"../repo/places/lobby.rogen.json",
		])("should read %s as a path", async (ref) => {
			await fs.createDirectory("/repo/places");
			await fs.writeFile("/repo/places/lobby.rogen.json", "{}");

			const result = await discovery.discover([ref]);

			expect(result.isOk() || errorOf(result).message).toBe(true);
		});

		it("should read a name ending in .json as a path, not as <name>.rogen.json", async () => {
			await fs.writeFile("/repo/odd.json.rogen.json", "{}");

			const result = await discovery.discover(["odd.json"]);

			expect(errorOf(result).message).toBe(
				"Config file not found: /repo/odd.json"
			);
		});

		it("should read a name with a dot but no separator or .json as a name", async () => {
			await fs.writeFile("/repo/lobby.sync.rogen.json", "{}");

			const result = await discovery.discover(["lobby.sync"]);

			expect(result.unwrap().files).toEqual([
				"/repo/lobby.sync.rogen.json",
			]);
		});

		it("should mix with names, in the order given", async () => {
			await fs.writeFile("/repo/lobby.rogen.json", "{}");
			await fs.writeFile("/repo/extra.rogen.json", "{}");

			const result = await discovery.discover([
				"extra.rogen.json",
				"lobby",
			]);

			expect(result.unwrap().files).toEqual([
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

describe("ConfigDiscovery in subfolders", () => {
	let fs: MemoryFileSystemService;

	const from = (cwd: string) =>
		new ConfigDiscovery(fs, new MockEnvironmentService(cwd));
	const extending = (parent: string) => JSON.stringify({ extends: parent });

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo/places/lobby");
		await fs.writeFile("/repo/default.rogen.json", "{}");
	});

	it("should find a config below that extends one here", async () => {
		await fs.writeFile(
			"/repo/places/lobby/lobby.rogen.json",
			extending("../../default.rogen.json")
		);

		const result = await from("/repo").discover([]);

		expect(result.unwrap().files).toEqual([
			"/repo/default.rogen.json",
			"/repo/places/lobby/lobby.rogen.json",
		]);
	});

	it("should find a config whose chain reaches here through another below", async () => {
		await fs.writeFile(
			"/repo/places/base.rogen.json",
			extending("../default.rogen.json")
		);
		await fs.writeFile(
			"/repo/places/lobby/lobby.rogen.json",
			extending("../base.rogen.json")
		);

		const result = await from("/repo").discover([]);

		expect(result.unwrap().files).toEqual([
			"/repo/default.rogen.json",
			"/repo/places/base.rogen.json",
			"/repo/places/lobby/lobby.rogen.json",
		]);
	});

	it("should leave a config that extends nothing here as separate", async () => {
		await fs.createDirectory("/repo/fixtures/plain");
		await fs.writeFile("/repo/fixtures/plain/plain.rogen.json", "{}");
		await fs.writeFile("/repo/fixtures/base.rogen.json", "{}");
		await fs.writeFile(
			"/repo/fixtures/plain/child.rogen.json",
			extending("../base.rogen.json")
		);

		const result = (await from("/repo").discover([])).unwrap();

		expect(result.files).toEqual(["/repo/default.rogen.json"]);
		expect(result.separate).toEqual([
			"/repo/fixtures/base.rogen.json",
			"/repo/fixtures/plain/child.rogen.json",
			"/repo/fixtures/plain/plain.rogen.json",
		]);
	});

	it("should keep a config it can't read, so its errors are reported", async () => {
		await fs.writeFile("/repo/places/lobby/lobby.rogen.json", "{ nope");

		const result = await from("/repo").discover([]);

		expect(result.unwrap().files).toContain(
			"/repo/places/lobby/lobby.rogen.json"
		);
	});

	it("should keep a config that extends a missing file here", async () => {
		await fs.writeFile(
			"/repo/places/lobby/lobby.rogen.json",
			extending("../../gone.rogen.json")
		);

		const result = await from("/repo").discover([]);

		expect(result.unwrap().files).toContain(
			"/repo/places/lobby/lobby.rogen.json"
		);
	});

	it.each([
		".git",
		"node_modules",
		"Packages",
		"ServerPackages",
		"DevPackages",
		"roblox_packages",
		"roblox_server_packages",
		"lune_packages",
		"luau_packages",
	])("should not search %s", async (folder) => {
		await fs.createDirectory(`/repo/${folder}/pkg`);
		await fs.writeFile(
			`/repo/${folder}/pkg/pkg.rogen.json`,
			extending("../../default.rogen.json")
		);

		const result = (await from("/repo").discover([])).unwrap();

		expect(result.files).toEqual(["/repo/default.rogen.json"]);
		expect(result.folders).not.toContain(`/repo/${folder}`);
	});

	it("should not search a config's sync dir", async () => {
		await fs.writeFile(
			"/repo/default.rogen.json",
			JSON.stringify({ syncDir: "out" })
		);
		await fs.createDirectory("/repo/out");
		await fs.writeFile(
			"/repo/out/copy.rogen.json",
			extending("../default.rogen.json")
		);

		const result = (await from("/repo").discover([])).unwrap();

		expect(result.files).toEqual(["/repo/default.rogen.json"]);
	});

	it("should not follow a linked folder", async () => {
		await fs.createDirectory("/elsewhere");
		await fs.writeFile(
			"/elsewhere/away.rogen.json",
			extending("../repo/default.rogen.json")
		);
		await fs.createSymbolicLink("/elsewhere", "/repo/linked");

		const result = (await from("/repo").discover([])).unwrap();

		expect(result.files).toEqual(["/repo/default.rogen.json"]);
	});

	it("should list every folder it searched", async () => {
		const result = (await from("/repo").discover([])).unwrap();

		expect(result.folders).toEqual([
			"/repo",
			"/repo/places",
			"/repo/places/lobby",
		]);
	});

	it("should fail, naming both, when two configs share a name", async () => {
		await fs.writeFile(
			"/repo/places/lobby/default.rogen.json",
			extending("../../default.rogen.json")
		);

		const result = await from("/repo").discover([]);

		expect(errorOf(result)).toBeInstanceOf(UsageError);
		expect(errorOf(result).message).toBe(
			'Two configs are named "default": default.rogen.json and places/lobby/default.rogen.json. Rename one, since a name has to mean one config.'
		);
	});

	it("should read only a subfolder's configs when run there", async () => {
		await fs.writeFile(
			"/repo/places/lobby/lobby.rogen.json",
			extending("../../default.rogen.json")
		);

		const result = await from("/repo/places/lobby").discover([]);

		expect(result.unwrap().files).toEqual([
			"/repo/places/lobby/lobby.rogen.json",
		]);
	});

	describe("by name", () => {
		it("should find a config below by its name", async () => {
			await fs.writeFile(
				"/repo/places/lobby/lobby.rogen.json",
				extending("../../default.rogen.json")
			);

			const result = await from("/repo").discover(["lobby"]);

			expect(result.unwrap()).toEqual({
				directory: "/repo",
				files: ["/repo/places/lobby/lobby.rogen.json"],
				everyConfig: false,
				separate: [],
				folders: [],
			});
		});

		it("should fail when the name only matches a separate config", async () => {
			await fs.writeFile("/repo/places/lobby/lobby.rogen.json", "{}");

			const result = await from("/repo").discover(["lobby"]);

			expect(errorOf(result)).toBeInstanceOf(UsageError);
			expect(errorOf(result).message).toBe(
				'Config "lobby" is places/lobby/lobby.rogen.json, which extends nothing here, so it is a separate project. Add "extends" to make it part of this one, or build it by its path.'
			);
		});

		it("should fail when the name means two configs", async () => {
			await fs.writeFile(
				"/repo/places/lobby/default.rogen.json",
				extending("../../default.rogen.json")
			);

			const result = await from("/repo").discover(["default"]);

			expect(errorOf(result).message).toContain(
				'Two configs are named "default"'
			);
		});

		it("should still read a path when two configs share a name", async () => {
			await fs.writeFile(
				"/repo/places/lobby/default.rogen.json",
				extending("../../default.rogen.json")
			);

			const result = await from("/repo").discover([
				"places/lobby/default.rogen.json",
			]);

			expect(result.unwrap().files).toEqual([
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

	it("should find the nearest parent folder with a config", async () => {
		await fs.writeFile("/repo/default.rogen.json", "{}");
		await fs.writeFile("/repo/src/lobby.rogen.json", "{}");

		const found = await from("/repo/src/Inventory").findEnclosing();

		expect(found).toEqual({
			directory: "/repo/src",
			fileNames: ["lobby.rogen.json"],
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
});
