import path from "path";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { configServiceOf } from "../../config/__tests__/config-of.js";
import { AskedPaths, skippedNotes } from "../asked-paths.js";
import { writeServiceOf } from "./fixtures.js";

describe("AskedPaths", () => {
	let fs: MemoryFileSystemService;

	const ask = (cwd: string, ...given: string[]) => {
		const configs = configServiceOf(fs, new MockEnvironmentService(cwd));
		return AskedPaths.of(
			configs,
			writeServiceOf(fs, new CoreIndexService(fs)),
			cwd,
			given
		);
	};

	const place = (name: string) =>
		fs.writeFile(
			`/repo/places/${name}/default.rogen.json`,
			JSON.stringify({
				name,
				sourcePaths: ["../shared/src", "src"],
				routes: { "*": "ReplicatedStorage" },
			})
		);

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo/.git");
		await fs.writeFile("/repo/places/shared/src/A.luau", "");
	});

	it("should fail on a name that both extensions of a config have", async () => {
		await fs.writeFile("/repo/game.rogen.json", "{}");
		await fs.writeFile("/repo/game.rogen.jsonc", "{}");

		expect((await ask("/repo", "game")).isErr()).toBe(true);
	});

	it("should fail on an instance when no config is here to place it", async () => {
		expect((await ask("/repo", "ReplicatedStorage.A")).isErr()).toBe(true);
	});

	it("should name the configs that read a path no config lies above", async () => {
		await place("lobby");
		const file = path.resolve("/repo/places/shared/src/A.luau");

		const asked = (await ask("/repo", file)).unwrap();

		expect(asked.uncovered).toEqual([
			{
				path: file,
				reason: "noConfig",
				readers: ["/repo/places/lobby/default.rogen.json"],
			},
		]);
	});
});

describe("skippedNotes", () => {
	const ask = { command: "check", lead: "Check it" };

	const notesOf = (
		skipped: Parameters<typeof skippedNotes>[1],
		named: string[] = []
	) =>
		skippedNotes(
			Object.assign(
				configServiceOf(
					new MemoryFileSystemService(),
					new MockEnvironmentService("/repo")
				),
				{ namedConfigs: async () => named }
			),
			skipped,
			"/repo",
			ask
		);

	it("should point at the one config that reads a path", async () => {
		expect(
			await notesOf([
				{
					path: "/repo/shared/A.luau",
					reason: "noConfig",
					readers: ["/repo/lobby/default.rogen.json"],
				},
			])
		).toEqual([
			"note: shared/A.luau: no config at or above it reads it, but another config lists it in its source paths. Check it through that config: 'rogen check lobby/default.rogen.json'.",
		]);
	});

	it("should name no config to go through when there is none", async () => {
		expect(
			await notesOf([{ path: "/repo/shared/A.luau", reason: "noConfig" }])
		).toEqual(["note: shared/A.luau: no config at or above it reads it."]);
	});

	it("should name the configs here to go through", async () => {
		expect(
			await notesOf(
				[{ path: "/repo/shared/A.luau", reason: "noConfig" }],
				["/repo/game.rogen.json", "/repo/lobby.rogen.json"]
			)
		).toEqual([
			"note: shared/A.luau: no config at or above it reads it. Check it through one: rogen check game.rogen.json or lobby.rogen.json.",
		]);
	});
});
