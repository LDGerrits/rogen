import {
	errors,
	resolved,
	start,
	useConfigFixture,
	write,
} from "./config-fixture.js";

const ROUTED = { server: "ServerScriptService" };

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("keys", () => {
		const warningsOf = (index = 0) => resolved(index)?.warnings ?? [];

		it("should pass Rojo's keys through to the project", async () => {
			await write("/repo/rogen.json", {
				servePort: 34873,
				servePlaceIds: [1, 2],
				blockedPlaceIds: [3],
				placeId: 4,
				gameId: 5,
				serveAddress: "0.0.0.0",
				serveAllowedHosts: ["lan"],
				emitLegacyScripts: false,
				globIgnorePaths: ["**/*.spec.luau"],
				syncbackRules: { ignoreTrees: ["Workspace"] },
			});

			await start();

			expect(errors(0)).toEqual([]);
			expect(warningsOf()).toEqual([]);
			expect(resolved(0)?.project.getFile()).toMatchObject({
				servePort: 34873,
				servePlaceIds: [1, 2],
				blockedPlaceIds: [3],
				placeId: 4,
				gameId: 5,
				serveAddress: "0.0.0.0",
				serveAllowedHosts: ["lan"],
				emitLegacyScripts: false,
				globIgnorePaths: ["**/*.spec.luau"],
				syncbackRules: { ignoreTrees: ["Workspace"] },
			});
		});

		it("should warn about a key on neither list, and pass it through", async () => {
			await write(
				"/repo/rogen.json",
				`{
	"bogus": 1
}`
			);

			await start();

			expect(errors(0)).toEqual([]);
			expect(warningsOf()).toMatchObject([
				{
					code: "config.unknownField",
					resource: "/repo/rogen.json",
					position: { line: 2, column: 2 },
					message: expect.stringContaining(
						'"bogus" is not a Rojo key and not Rogen\'s: it is passed through, and Rojo will reject the written file by this name.'
					),
				},
			]);
			expect(resolved(0)?.project.getFile()).toMatchObject({ bogus: 1 });
		});

		it("should suggest the key a misspelling is closest to", async () => {
			await write("/repo/rogen.json", { sourcePath: ["src"] });

			await start();

			expect(warningsOf()[0].message).toContain(
				'Did you mean "sourcePaths"?'
			);
		});

		it("should accept syncRules", async () => {
			await write(
				"/repo/rogen.json",
				`{
	"syncRules": [{ "pattern": "*.md", "use": "text" }]
}`
			);

			await start();

			expect(errors(0)).toEqual([]);
		});

		it("should refuse a sync rule Rojo can't read", async () => {
			await write(
				"/repo/rogen.json",
				`{
	"syncRules": [
		{ "pattern": "*.md", "use": "text" },
		{ "pattern": "*.txt", "use": "stone" }
	]
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.invalidSyncRule",
					position: { line: 4, column: 3 },
					message: expect.stringContaining('"syncRules[1]"'),
				},
			]);
		});

		it("should refuse a field a sync rule does not have", async () => {
			await write(
				"/repo/rogen.json",
				`{
	"syncRules": [{ "pattern": "*.md", "use": "text", "origin": "/x" }]
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.unknownField",
					message: expect.stringContaining("syncRules[0].origin"),
				},
			]);
		});

		it("should refuse sourcePaths without routes", async () => {
			await write("/repo/rogen.json", { sourcePaths: ["src"] });

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.sourcePathsWithoutRoutes",
					message: expect.stringContaining("declares no routes"),
				},
			]);
		});

		it("should refuse routes under a root that is not a DataModel", async () => {
			await write("/repo/rogen.json", {
				routes: ROUTED,
				tree: { $className: "Folder" },
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "tree.rootNotDataModel",
					message: expect.stringContaining(
						"is a Folder, not a DataModel"
					),
				},
			]);
		});

		it("should refuse routes under a $path root", async () => {
			await write("/repo/rogen.json", {
				routes: ROUTED,
				tree: { $path: "lib" },
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "tree.rootNotDataModel",
					message: expect.stringContaining("is a $path"),
				},
			]);
		});

		it("should accept any root without routes", async () => {
			await write("/repo/rogen.json", { tree: { $path: "lib" } });

			await start();

			expect(errors(0)).toEqual([]);
		});
	});
});
