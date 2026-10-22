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
			await write("/repo/default.rogen.json", {
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

		it("should refuse a key on neither list, which Rojo would reject", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"bogus": 1
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.unknownField",
					resource: "/repo/default.rogen.json",
					position: { line: 2, column: 2 },
					message: expect.stringContaining(
						"\"bogus\" is not a Rojo key and not Rogen's, and Rojo rejects a project file with a key it doesn't know."
					),
				},
			]);
		});

		it("should refuse a $ key of a node that is no field and holds no object", async () => {
			await write("/repo/default.rogen.json", {
				tree: {
					$className: "DataModel",
					Workspace: { $clasName: "Folder" },
				},
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.unknownField",
					message: expect.stringContaining(
						'"tree.Workspace.$clasName" is not a field of a node'
					),
				},
			]);
			expect(errors(0)[0].message).toContain(
				'Did you mean "$className"?'
			);
		});

		it("should leave a $ key holding an object to the build, since Rojo reads it as a child", async () => {
			await write("/repo/default.rogen.json", {
				tree: { $className: "DataModel", Workspace: { $Thing: {} } },
			});

			await start();

			expect(errors(0)).toEqual([]);
		});

		it("should suggest the key a misspelling is closest to", async () => {
			await write("/repo/default.rogen.json", {
				rogen: { sourcePath: ["src"] },
			});

			await start();

			expect(errors(0)[0].message).toContain(
				'Did you mean "sourcePaths"?'
			);
		});

		it("should offer the suggested key as a text replacement", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"rogen": {
		"sourcePath": ["src"]
	}
}`
			);

			await start();

			expect(errors(0)[0].fixes).toEqual([
				{
					replace: {
						file: "/repo/default.rogen.json",
						line: 3,
						column: 3,
						from: '"sourcePath"',
						to: '"sourcePaths"',
					},
				},
			]);
		});

		it("should offer no replacement for a key nothing is close to", async () => {
			await write("/repo/default.rogen.json", `{\n\t"zzzzzzzz": 1\n}`);

			await start();

			expect(errors(0)[0].fixes).toBeUndefined();
		});

		it("should refuse a key in the rogen block that is not Rogen's, pointing into the block", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"rogen": {
		"zzzzzzzz": 1
	}
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.unknownField",
					position: { line: 3, column: 3 },
					message: '"zzzzzzzz" is not one of Rogen\'s keys.',
				},
			]);
		});

		it("should refuse a Rogen key at the top level, and move a lone one into the block", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"name": "Game",
	"routes": { "server": "ServerScriptService" }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.rogenKeyOutsideBlock",
					position: { line: 3, column: 2 },
					fixes: [
						{
							replace: {
								file: "/repo/default.rogen.json",
								line: 3,
								column: 2,
								from: '"routes": { "server": "ServerScriptService" }',
								to: '"rogen": { "routes": { "server": "ServerScriptService" } }',
							},
						},
					],
				},
			]);
		});

		it("should offer no move for several Rogen keys at the top level, or when the block is there", async () => {
			await write("/repo/default.rogen.json", {
				sourcePaths: ["src"],
				routes: ROUTED,
				rogen: {},
			});

			await start();

			expect(errors(0).map(({ code }) => code)).toEqual([
				"config.rogenKeyOutsideBlock",
				"config.rogenKeyOutsideBlock",
			]);
			expect(errors(0).map(({ fixes }) => fixes)).toEqual([
				undefined,
				undefined,
			]);
		});

		it("should leave the rogen block out of the project", async () => {
			await write("/repo/default.rogen.json", {
				name: "Game",
				rogen: {
					sourcePaths: ["src"],
					routes: ROUTED,
					compiledPath: "out",
				},
			});

			await start();

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.project.getFile()).not.toHaveProperty("rogen");
		});

		it("should read a file with no rogen block as a plain Rojo project", async () => {
			await write("/repo/default.rogen.json", {
				name: "Game",
				tree: { $className: "DataModel" },
			});

			await start();

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.routes.size).toBe(0);
			expect(resolved(0)?.sourcePaths).toEqual([]);
		});

		it("should accept syncRules", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"syncRules": [{ "pattern": "*.md", "use": "text" }]
}`
			);

			await start();

			expect(errors(0)).toEqual([]);
		});

		it("should refuse a sync rule Rojo can't read", async () => {
			await write(
				"/repo/default.rogen.json",
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

		it("should warn of a field a sync rule does not have", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"syncRules": [{ "pattern": "*.md", "use": "text", "sufix": ".md" }]
}`
			);

			await start();

			expect(errors(0)).toEqual([]);
			expect(warningsOf(0)).toMatchObject([
				{
					code: "config.unknownField",
					message: expect.stringContaining('Did you mean "suffix"?'),
				},
			]);
		});

		it("should refuse sourcePaths without routes", async () => {
			await write("/repo/default.rogen.json", {
				rogen: { sourcePaths: ["src"] },
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.sourcePathsWithoutRoutes",
					message: expect.stringContaining("declares no routes"),
				},
			]);
		});

		it("should refuse routes under a root that is not a DataModel", async () => {
			await write("/repo/default.rogen.json", {
				tree: { $className: "Folder" },
				rogen: { routes: ROUTED },
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
			await write("/repo/default.rogen.json", {
				tree: { $path: "lib" },
				rogen: { routes: ROUTED },
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
			await write("/repo/default.rogen.json", { tree: { $path: "lib" } });

			await start();

			expect(errors(0)).toEqual([]);
		});
	});
});
