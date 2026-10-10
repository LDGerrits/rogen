import { jest } from "@jest/globals";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	useConfigFixture,
	useFileSystem,
	selection,
	write,
	plain,
	start,
	resolved,
	errors,
} from "./config-fixture.js";

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("resolution", () => {
		const diagnosticsFor = async (
			config: Record<string, unknown> | string,
			file = "default"
		) => {
			await write(`/repo/${file}.rogen.json`, config);
			await start({ names: [file] });
			return errors(0).map((d) => [
				d.message,
				d.resource,
				d.position?.line,
				d.position?.column,
			]);
		};

		it("should apply a default only when the whole chain leaves the field out", async () => {
			await write("/repo/base.rogen.json", {
				exclude: ["**/*.spec.luau"],
				rootDirs: ["core"],
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(resolved(0)).toMatchObject({
				exclude: ["/repo/**/*.spec.luau"],
				rootDirs: ["/repo/core"],
				routes: {},
				variants: {},
			});
		});

		it("should not inject a route set when the chain declares no routes", async () => {
			await write("/repo/default.rogen.json", {});

			await start();

			expect(plain(resolved(0))?.routes).toEqual({});
		});

		it("should default outFile from the config's stem", async () => {
			await write("/repo/lobby.rogen.json", {});

			await start({ names: ["lobby"] });

			expect(resolved(0)?.outFile).toBe("/repo/lobby.project.json");
		});

		describe("project name", () => {
			it("should prefer the template's own name", async () => {
				await write("/repo/t.project.json", {
					name: "FromTemplate",
					tree: {},
				});
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});

				await start();

				expect(resolved(0)?.name).toBe("FromTemplate");
			});

			it("should fall back to the config's directory when the template has no name", async () => {
				await write("/repo/t.project.json", { tree: {} });
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});

				await start();

				expect(resolved(0)?.name).toBe("repo");
			});

			it("should fall back to the config's directory when there is no template", async () => {
				await write("/repo/default.rogen.json", {});

				await start();

				expect(resolved(0)?.name).toBe("repo");
			});

			it("should never be empty", async () => {
				await useFileSystem(new MemoryFileSystemService(), "/");
				await write("/default.rogen.json", {});

				await start({}, "/");

				expect(resolved(0)?.name).toBe("project");
			});

			it("should ignore an empty template name", async () => {
				await write("/repo/t.project.json", { name: "", tree: {} });
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});

				await start();

				expect(resolved(0)?.name).toBe("repo");
			});
		});

		describe("template", () => {
			it("should carry the parsed template and its file", async () => {
				await write("/repo/t.project.json", {
					name: "Game",
					tree: { $className: "DataModel" },
				});
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});

				await start();

				expect(plain(resolved(0))?.template).toEqual({
					file: "/repo/t.project.json",
					project: {
						name: "Game",
						tree: { $className: "DataModel" },
					},
				});
				expect(selection.files).toContain("/repo/t.project.json");
			});

			it("should report a missing template at the field that named it", async () => {
				const problems = await diagnosticsFor(`{
	"template": "missing.project.json"
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toBe(
					"the template does not exist (looked for /repo/missing.project.json). Paths are relative to the config that sets them."
				);
				expect(problems[0].slice(1)).toEqual([
					"/repo/default.rogen.json",
					2,
					14,
				]);
				expect(selection.files).toContain("/repo/missing.project.json");
			});

			it("should report a template that is not a JSON object", async () => {
				await write("/repo/t.project.json", "[1]");

				const problems = await diagnosticsFor({
					template: "t.project.json",
				});

				expect(problems.map((p) => p[0])).toEqual([
					"the template is not a valid Rojo project file: it must be a JSON object.",
				]);
			});

			it("should report a template with invalid JSON", async () => {
				await write("/repo/t.project.json", "{ nope");

				const problems = await diagnosticsFor({
					template: "t.project.json",
				});

				expect(problems[0][0]).toContain(
					"the template is not a valid Rojo project file: invalid JSONC"
				);
			});

			it("should point at the parent file that named the template", async () => {
				await write(
					"/repo/base.rogen.json",
					`{
	"template": "missing.project.json"
}`
				);

				const problems = await diagnosticsFor({
					extends: "./base.rogen.json",
				});

				expect(problems[0].slice(1)).toEqual([
					"/repo/base.rogen.json",
					2,
					14,
				]);
			});

			it("should merge a child's template over its parent's, rebasing the parent's paths", async () => {
				await write("/repo/places/shared/template.project.json", {
					name: "Game",
					servePort: 34872,
					globIgnorePaths: ["**/*.spec.luau"],
					tree: {
						$className: "DataModel",
						ReplicatedStorage: {
							Packages: { $path: "../../Packages" },
						},
					},
				});
				await write("/repo/places/lobby/template.project.json", {
					name: "Lobby",
					servePort: 34873,
				});
				await write("/repo/default.rogen.json", {
					template: "places/shared/template.project.json",
				});
				await write("/repo/lobby.rogen.json", {
					extends: "./default.rogen.json",
					template: "places/lobby/template.project.json",
				});

				await start({ names: ["lobby"] });

				expect(resolved(0)?.name).toBe("Lobby");
				expect(plain(resolved(0))?.template).toEqual({
					file: "/repo/places/lobby/template.project.json",
					project: {
						name: "Lobby",
						servePort: 34873,
						globIgnorePaths: ["../shared/**/*.spec.luau"],
						tree: {
							$className: "DataModel",
							ReplicatedStorage: {
								Packages: { $path: "../../Packages" },
							},
						},
					},
				});
				expect(resolved(0)?.template?.bases).toEqual([
					"/repo/places/shared/template.project.json",
				]);
				expect([...selection.files]).toEqual(
					expect.arrayContaining([
						"/repo/places/shared/template.project.json",
						"/repo/places/lobby/template.project.json",
					])
				);
			});

			it("should merge every template down a chain, the nearest last", async () => {
				await write("/repo/a.template.json", {
					name: "A",
					tree: { Lighting: { $properties: { Brightness: 1 } } },
				});
				await write("/repo/b.template.json", {
					tree: { Workspace: { $properties: { Gravity: 100 } } },
				});
				await write("/repo/c.template.json", { name: "C" });
				await write("/repo/a.rogen.json", {
					template: "a.template.json",
				});
				await write("/repo/b.rogen.json", {
					extends: "./a.rogen.json",
					template: "b.template.json",
				});
				await write("/repo/c.rogen.json", {
					extends: "./b.rogen.json",
					template: "c.template.json",
				});

				await start({ names: ["c"] });

				expect(resolved(0)?.template?.project.getTree()).toEqual({
					name: "C",
					tree: {
						$className: "DataModel",
						Lighting: { $properties: { Brightness: 1 } },
						Workspace: { $properties: { Gravity: 100 } },
					},
				});
				expect(resolved(0)?.template?.bases).toEqual([
					"/repo/a.template.json",
					"/repo/b.template.json",
				]);
			});

			it("should merge a template a child names again over the ones between", async () => {
				await write("/repo/t.template.json", { name: "T" });
				await write("/repo/m.template.json", { name: "M" });
				await write("/repo/root.rogen.json", {
					template: "t.template.json",
				});
				await write("/repo/mid.rogen.json", {
					extends: "./root.rogen.json",
					template: "m.template.json",
				});
				await write("/repo/default.rogen.json", {
					extends: "./mid.rogen.json",
					template: "t.template.json",
				});

				await start();

				expect(resolved(0)?.name).toBe("T");
				expect(resolved(0)?.template?.bases).toEqual([
					"/repo/m.template.json",
				]);
			});

			it("should name the template that set a field it lost to, down a chain", async () => {
				await write("/repo/a.template.json", {
					tree: { Lighting: { $properties: { Brightness: 1 } } },
				});
				await write("/repo/b.template.json", {
					tree: { Lighting: { $properties: { Brightness: 2 } } },
				});
				await write("/repo/c.template.json", { name: "C" });
				await write("/repo/a.rogen.json", {
					template: "a.template.json",
				});
				await write("/repo/b.rogen.json", {
					extends: "./a.rogen.json",
					template: "b.template.json",
				});
				await write("/repo/c.rogen.json", {
					extends: "./b.rogen.json",
					template: "c.template.json",
				});

				await start({ names: ["c"] });

				expect(resolved(0)?.template?.clashes).toEqual([
					{
						instancePath: ["Lighting"],
						field: "$properties.Brightness",
						file: "/repo/b.template.json",
						base: "/repo/a.template.json",
					},
				]);
			});

			it("should read a template a child names again only once", async () => {
				await write("/repo/t.project.json", { name: "Game", tree: {} });
				await write("/repo/base.rogen.json", {
					template: "t.project.json",
				});
				await write("/repo/default.rogen.json", {
					extends: "./base.rogen.json",
					template: "t.project.json",
				});

				await start();

				expect(resolved(0)?.template?.bases).toEqual([]);
				expect(resolved(0)?.template?.clashes).toEqual([]);
			});

			it("should carry what the child's template overrode in its parent's", async () => {
				await write("/repo/base.project.json", {
					name: "Game",
					tree: {
						ReplicatedStorage: { Packages: { $path: "Packages" } },
					},
				});
				await write("/repo/lobby.project.json", {
					tree: {
						ReplicatedStorage: { Packages: { $path: "vendor" } },
					},
				});
				await write("/repo/default.rogen.json", {
					template: "base.project.json",
				});
				await write("/repo/lobby.rogen.json", {
					extends: "./default.rogen.json",
					template: "lobby.project.json",
					outFile: "out/lobby.project.json",
				});

				await start({ names: ["lobby"] });

				expect(resolved(0)?.template?.clashes).toEqual([
					{
						instancePath: ["ReplicatedStorage", "Packages"],
						field: "$path",
						file: "/repo/lobby.project.json",
						base: "/repo/base.project.json",
					},
				]);
			});

			it("should report a parent's broken template even when the child names its own", async () => {
				await write("/repo/lobby.project.json", { name: "Lobby" });
				await write(
					"/repo/base.rogen.json",
					`{
	"template": "missing.project.json"
}`
				);

				const problems = await diagnosticsFor({
					extends: "./base.rogen.json",
					template: "lobby.project.json",
				});

				expect(problems.map((problem) => problem.slice(1))).toEqual([
					["/repo/base.rogen.json", 2, 14],
				]);
			});

			it("should report a change when the template's contents change", async () => {
				await write("/repo/t.project.json", { name: "One", tree: {} });
				await write("/repo/default.rogen.json", {
					template: "t.project.json",
				});
				await start();

				await write("/repo/t.project.json", { name: "Two", tree: {} });
				const reload = await selection.reload(["/repo/t.project.json"]);

				expect(resolved(0)?.name).toBe("Two");
				expect(reload.changed).toEqual(["/repo/default.rogen.json"]);
			});
		});

		describe("validation", () => {
			it("should reject a route key with a separator", async () => {
				const problems = await diagnosticsFor(`{
	"routes": {
		"my-key": "ServerScriptService"
	}
}`);

				expect(problems).toEqual([
					[
						'route key "my-key" is invalid: use letters and digits only, starting with a letter.',
						"/repo/default.rogen.json",
						3,
						13,
					],
				]);
			});

			it("should accept the fallback route key", async () => {
				expect(
					await diagnosticsFor({
						routes: { "*": "ReplicatedStorage" },
					})
				).toEqual([]);
			});

			it("should reject a variant name that starts with a digit", async () => {
				const problems = await diagnosticsFor(`{
	"variants": ["1st"]
}`);

				expect(problems).toEqual([
					[
						'variant "1st" is invalid: use letters and digits only, starting with a letter.',
						"/repo/default.rogen.json",
						2,
						15,
					],
				]);
			});

			it("should reject a variant that shares a name with a route key", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"variants": ["server"]
}`);

				expect(problems).toEqual([
					[
						'variant "server" has the same name as a route key; rename one of them.',
						"/repo/default.rogen.json",
						3,
						15,
					],
				]);
			});

			it("should accept a variant named like a property every object has", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"variants": ["constructor"]
}`);

				expect(problems).toEqual([]);
			});

			it("should reject two route keys that differ only in the case of their first letter", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService", "Server": "Workspace" }
}`);

				expect(problems).toEqual([
					[
						'"Server" and "server" differ only in the case of their first letter, so both would match the same names; keep one of them.',
						"/repo/default.rogen.json",
						2,
						57,
					],
				]);
			});

			it("should reject two variants that differ only in the case of their first letter", async () => {
				const problems = await diagnosticsFor(`{
	"variants": ["mock", "Mock"]
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain('"Mock" and "mock"');
			});

			it("should reject a variant that differs from a route key only in the case of its first letter", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "ServerScriptService" },
	"variants": ["Server"]
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain('"Server" and "server"');
			});

			it("should accept keys that differ beyond the first letter", async () => {
				expect(
					await diagnosticsFor({
						routes: { server: "ServerScriptService" },
						variants: ["SERVER"],
					})
				).toEqual([]);
			});

			it("should reject a route target whose service is unsupported", async () => {
				const problems = await diagnosticsFor(`{
	"routes": { "server": "Nowhere/Folder" }
}`);

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain(
					'"Nowhere" is not a supported service'
				);
				expect(problems[0].slice(1)).toEqual([
					"/repo/default.rogen.json",
					2,
					24,
				]);
			});

			it("should point at the parent that supplied a bad route", async () => {
				await write(
					"/repo/base.rogen.json",
					`{
	"routes": { "server": "Nowhere" }
}`
				);

				const problems = await diagnosticsFor({
					extends: "./base.rogen.json",
					routes: { client: "StarterGui" },
				});

				expect(problems.map((p) => p.slice(1))).toEqual([
					["/repo/base.rogen.json", 2, 24],
				]);
			});

			it("should reject writing over its own template", async () => {
				await write("/repo/game.project.json", { tree: {} });

				const problems = await diagnosticsFor(`{
	"template": "game.project.json",
	"outFile": "game.project.json"
}`);

				expect(problems).toEqual([
					[
						'the output file /repo/game.project.json is also the template, and a build would overwrite it. Set "outFile" to another path.',
						"/repo/default.rogen.json",
						3,
						13,
					],
				]);
			});

			it("should reject a default outFile that is the template", async () => {
				await write("/repo/default.project.json", { tree: {} });

				const problems = await diagnosticsFor(`{
	"template": "default.project.json"
}`);

				expect(problems.map((p) => p[0])).toEqual([
					'the output file /repo/default.project.json is also the template, and a build would overwrite it. Set "outFile" to another path.',
				]);
				expect(problems[0].slice(1)).toEqual([
					"/repo/default.rogen.json",
					2,
					14,
				]);
			});

			it("should reject a default outFile that is a parent's template", async () => {
				await write("/repo/lobby.project.json", { tree: {} });
				await write("/repo/lobby.template.json", { name: "Lobby" });
				await write(
					"/repo/base.rogen.json",
					`{
	"template": "lobby.project.json"
}`
				);

				const problems = await diagnosticsFor(
					{
						extends: "./base.rogen.json",
						template: "lobby.template.json",
					},
					"lobby"
				);

				expect(problems).toEqual([
					[
						'the output file /repo/lobby.project.json is also the template, and a build would overwrite it. Set "outFile" to another path.',
						"/repo/base.rogen.json",
						2,
						14,
					],
				]);
			});

			it("should reject a root dir inside another, naming both", async () => {
				const problems = await diagnosticsFor(`{
	"rootDirs": ["src", "src/shared"]
}`);

				expect(problems).toEqual([
					[
						'root dir "/repo/src/shared" is inside root dir "/repo/src"; a file under it would belong to both. Remove one.',
						"/repo/default.rogen.json",
						2,
						22,
					],
				]);
			});

			it("should reject a root dir listed twice, at the repeat", async () => {
				const problems = await diagnosticsFor(`{
	"rootDirs": ["src", "./src"]
}`);

				expect(problems).toEqual([
					[
						'root dir "/repo/src" is listed twice; a file under it would belong to both. Remove one.',
						"/repo/default.rogen.json",
						2,
						22,
					],
				]);
			});

			it("should catch the nesting whichever order the root dirs come in", async () => {
				const problems = await diagnosticsFor({
					rootDirs: ["src/shared", "src"],
				});

				expect(problems).toHaveLength(1);
				expect(problems[0][0]).toContain(
					'root dir "/repo/src/shared" is inside root dir "/repo/src"'
				);
			});

			it("should accept root dirs that are only siblings or share a prefix", async () => {
				expect(
					await diagnosticsFor({
						rootDirs: ["core", "places/lobby", "core-extra"],
					})
				).toEqual([]);
			});

			it("should report every problem at once", async () => {
				const problems = await diagnosticsFor({
					routes: { "a-b": "Nowhere" },
					variants: ["c-d"],
					rootDirs: ["src", "src/x"],
				});

				expect(problems).toHaveLength(4);
			});

			it("should keep the last valid config when a reload turns a rule bad", async () => {
				await write("/repo/default.rogen.json", { rootDirs: ["a"] });
				await start();

				await write("/repo/default.rogen.json", {
					rootDirs: ["a", "a/b"],
				});
				await selection.reload(["/repo/default.rogen.json"]);

				expect(resolved(0)?.rootDirs).toEqual(["/repo/a"]);
				expect(errors(0)).toHaveLength(1);
			});
		});

		it("should read neither the working directory nor the clock", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			const cwd = jest.spyOn(process, "cwd");
			const now = jest.spyOn(Date, "now");

			await start();

			expect(cwd).not.toHaveBeenCalled();
			expect(now).not.toHaveBeenCalled();
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});
});
