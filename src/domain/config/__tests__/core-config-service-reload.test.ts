import path from "path";
import {
	useConfigFixture,
	fs,
	service,
	selection,
	write,
	start,
	resolved,
	errors,
} from "./config-fixture.js";

const ROUTED = { server: "ServerScriptService" };

const onDisk = (file: string): string => path.resolve(file);

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("reload of the config here", () => {
		beforeEach(async () => {
			await write("/repo/default.rogen.json", {
				sourcePaths: ["a"],
				routes: ROUTED,
			});
		});

		it("should know the folder it was picked from, and not when configs were named", async () => {
			await start();
			expect(selection.followedFolder).toEqual("/repo");

			await start({ names: ["."] });
			expect(selection.followedFolder).toBeUndefined();
		});

		it("should concern the config files of that folder and the files it reads", async () => {
			await start();

			expect(selection.concerns(onDisk("/repo/default.rogen.json"))).toBe(
				true
			);
			expect(
				selection.concerns(onDisk("/repo/default.rogen.jsonc"))
			).toBe(true);
			expect(
				selection.concerns(onDisk("/repo/src/default.rogen.json"))
			).toBe(false);
			expect(selection.concerns(onDisk("/repo/README.md"))).toBe(false);
		});

		it("should not concern the project file its config writes", async () => {
			await start();

			expect(
				selection.concerns(onDisk("/repo/default.project.json"))
			).toBe(false);
		});

		it("should concern the project file it adopted", async () => {
			await fs.delete("/repo/default.rogen.json");
			await write("/repo/default.project.json", {
				name: "Plain",
				tree: { $className: "DataModel" },
			});
			await start();

			expect(
				selection.concerns(onDisk("/repo/default.project.json"))
			).toBe(true);
		});

		it("should not concern a config of another name that comes to the folder", async () => {
			await start();

			await write("/repo/dist.rogen.json", { routes: ROUTED });
			const reload = await selection.reload([
				onDisk("/repo/dist.rogen.json"),
			]);

			expect(selection.concerns(onDisk("/repo/dist.rogen.json"))).toBe(
				false
			);
			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.rogen.json",
			]);
			expect(reload).toEqual({ changed: [], notices: [] });
		});

		it("should drop a config deleted from the folder, and report it", async () => {
			await start();

			await fs.delete("/repo/default.rogen.json");
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(selection.entries).toEqual([]);
			expect(reload.notices).toEqual([
				{ kind: "removed", file: "/repo/default.rogen.json" },
			]);
			expect(selection.files.has("/repo/default.rogen.json")).toBe(false);
		});

		it("should pick up a config that comes back to the folder, and report it", async () => {
			await start();
			await fs.delete("/repo/default.rogen.json");
			await selection.reload([onDisk("/repo/default.rogen.json")]);

			await write("/repo/default.rogen.json", {
				routes: ROUTED,
			});
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.rogen.json",
			]);
			expect(reload.changed).toEqual(["/repo/default.rogen.json"]);
			expect(reload.notices).toEqual([
				{ kind: "added", file: "/repo/default.rogen.json" },
			]);
		});

		it("should report a config that comes back broken with its errors, which no earlier version stands in for", async () => {
			await start();
			await fs.delete("/repo/default.rogen.json");
			await selection.reload([onDisk("/repo/default.rogen.json")]);

			await write("/repo/default.rogen.json", { modes: {} });
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(selection.entries[0].status).toBe("broken");
			expect(reload.changed).toEqual([]);
			expect(reload.notices).toMatchObject([
				{
					kind: "broken",
					file: "/repo/default.rogen.json",
					keptLastValid: false,
				},
			]);
		});

		it("should refuse the config it has while a second default config is beside it, as a fresh run does", async () => {
			await start();

			await write("/repo/default.rogen.jsonc", {
				routes: ROUTED,
			});
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.jsonc"),
			]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.rogen.json",
			]);
			expect(errors(0).map(({ code }) => code)).toEqual([
				"config.bothExtensions",
			]);
			expect(reload).toMatchObject({
				changed: [],
				notices: [
					{
						kind: "broken",
						file: "/repo/default.rogen.json",
						keptLastValid: true,
					},
				],
			});
		});

		it("should load the config again once the second default config is deleted", async () => {
			await start();
			await write("/repo/default.rogen.jsonc", { routes: ROUTED });
			await selection.reload([onDisk("/repo/default.rogen.jsonc")]);

			await fs.delete("/repo/default.rogen.jsonc");
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.jsonc"),
			]);

			expect(errors(0)).toEqual([]);
			expect(reload.notices).toEqual([
				{ kind: "recovered", file: "/repo/default.rogen.json" },
			]);
		});

		it("should take up a default config that comes beside the project file it adopted, as a fresh run does", async () => {
			await fs.delete("/repo/default.rogen.json");
			await write("/repo/default.project.json", {
				name: "Plain",
				tree: { $className: "DataModel" },
			});
			await start();

			await write("/repo/default.rogen.json", { routes: ROUTED });
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.rogen.json",
			]);
			expect(reload).toEqual({
				changed: ["/repo/default.rogen.json"],
				notices: [
					{ kind: "removed", file: "/repo/default.project.json" },
					{ kind: "added", file: "/repo/default.rogen.json" },
				],
			});
		});

		it("should pick up the project file it adopted when it comes back, as a fresh run does", async () => {
			await fs.delete("/repo/default.rogen.json");
			await write("/repo/default.project.json", {
				name: "Plain",
				tree: { $className: "DataModel" },
			});
			await start();
			await fs.delete("/repo/default.project.json");
			await selection.reload([onDisk("/repo/default.project.json")]);

			expect(
				selection.concerns(onDisk("/repo/default.project.json"))
			).toBe(true);
			await write("/repo/default.project.json", {
				name: "Plain",
				tree: { $className: "DataModel" },
			});
			const reload = await selection.reload([
				onDisk("/repo/default.project.json"),
			]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.project.json",
			]);
			expect(reload).toEqual({
				changed: ["/repo/default.project.json"],
				notices: [
					{ kind: "added", file: "/repo/default.project.json" },
				],
			});
		});

		it("should not adopt the project file its config wrote once the config is deleted", async () => {
			await fs.delete("/repo/default.rogen.json");
			await write("/repo/default.project.json", {
				name: "Plain",
				tree: { $className: "DataModel" },
			});
			await start();
			await write("/repo/default.rogen.json", { routes: ROUTED });
			await selection.reload([onDisk("/repo/default.rogen.json")]);

			await fs.delete("/repo/default.rogen.json");
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(selection.entries).toEqual([]);
			expect(
				selection.concerns(onDisk("/repo/default.project.json"))
			).toBe(false);
			expect(reload.notices).toEqual([
				{ kind: "removed", file: "/repo/default.rogen.json" },
			]);
		});

		it("should not look for new configs when the selection named its configs", async () => {
			await write("/repo/lobby/default.rogen.json", {});
			await start({ names: ["lobby"] });

			await write("/repo/lobby/default.rogen.jsonc", {});
			const reload = await selection.reload([
				onDisk("/repo/lobby/default.rogen.jsonc"),
			]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/lobby/default.rogen.json",
			]);
			expect(reload.notices).toMatchObject([
				{ kind: "broken", file: "/repo/lobby/default.rogen.json" },
			]);
		});
	});

	describe("reload", () => {
		it("should report each config whose value changed, in selection order", async () => {
			await write("/repo/one/default.rogen.json", {
				sourcePaths: ["a"],
				routes: ROUTED,
			});
			await write("/repo/two/default.rogen.json", {
				sourcePaths: ["z"],
				routes: ROUTED,
			});
			await start({ names: ["one", "two"] });

			await write("/repo/one/default.rogen.json", {
				sourcePaths: ["b"],
				routes: ROUTED,
			});
			const reload = await selection.reload([
				onDisk("/repo/one/default.rogen.json"),
			]);

			expect(reload).toEqual({
				changed: ["/repo/one/default.rogen.json"],
				notices: [],
			});
			expect(resolved(0)?.sourcePaths).toEqual(["/repo/one/b"]);
			expect(resolved(1)?.sourcePaths).toEqual(["/repo/two/z"]);
		});

		it("should report nothing when the resolved value is unchanged", async () => {
			await write("/repo/default.rogen.json", { name: "A" });
			await start();

			await write("/repo/default.rogen.json", { name: "A" });
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(reload).toEqual({ changed: [], notices: [] });
		});

		it("should report a change to the tree", async () => {
			await write("/repo/default.rogen.json", {
				tree: { $className: "DataModel" },
			});
			await start();

			await write("/repo/default.rogen.json", {
				tree: { $className: "DataModel", Workspace: {} },
			});
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(reload.changed).toEqual(["/repo/default.rogen.json"]);
		});

		it("should report a config whose routes only changed order, since their order is their precedence", async () => {
			await write("/repo/default.rogen.json", {
				routes: {
					server: "ServerScriptService",
					client: "StarterGui",
				},
			});
			await start();

			await write("/repo/default.rogen.json", {
				routes: {
					client: "StarterGui",
					server: "ServerScriptService",
				},
			});
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(reload.changed).toEqual(["/repo/default.rogen.json"]);
		});

		it("should keep the same config when a reload loads it unchanged, even after it broke", async () => {
			await write("/repo/default.rogen.json", { name: "A" });
			await start();
			const before = resolved(0);

			await write("/repo/default.rogen.json", { name: "A" });
			await selection.reload([onDisk("/repo/default.rogen.json")]);
			expect(resolved(0)).toBe(before);

			await fs.writeFile("/repo/default.rogen.json", "{ nope");
			await selection.reload([onDisk("/repo/default.rogen.json")]);
			await write("/repo/default.rogen.json", { name: "A" });
			await selection.reload([onDisk("/repo/default.rogen.json")]);
			expect(resolved(0)).toBe(before);
		});

		it("should give the new warning positions after an edit that only moves them, without reporting a change", async () => {
			const rule = `{ "pattern": "*.md", "use": "text", "sufix": ".md" }`;
			await write(
				"/repo/default.rogen.json",
				`{ "syncRules": [${rule}] }`
			);
			await start();

			await write(
				"/repo/default.rogen.json",
				`// comment\n{\n\t"syncRules": [${rule}]\n}`
			);
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(reload).toEqual({ changed: [], notices: [] });
			expect(resolved(0)?.warnings).toMatchObject([
				{ position: { line: 3 } },
			]);
		});

		it("should keep the last valid value when a reload breaks the config, and report the new errors", async () => {
			await write("/repo/default.rogen.json", { name: "A" });
			await start();

			await write(
				"/repo/default.rogen.json",
				`{
	"name": "B",
	"bogus": {}
}`
			);
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(resolved(0)?.projectName).toBe("A");
			expect(errors(0)).toMatchObject([
				{
					code: "config.unknownField",
					position: { line: 3, column: 2 },
				},
			]);
			expect(reload.changed).toEqual([]);
			expect(reload.notices).toEqual([
				{
					kind: "broken",
					file: "/repo/default.rogen.json",
					errors: errors(0),
					keptLastValid: true,
				},
			]);
		});

		it("should report only the errors the previous load didn't have", async () => {
			await write("/repo/default.rogen.json", { modes: {} });
			await start();

			await write("/repo/default.rogen.json", { modes: {}, mode: "x" });
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(errors(0)).toHaveLength(2);
			expect(
				reload.notices.flatMap((notice) =>
					notice.kind === "broken"
						? notice.errors.map(({ message }) => message)
						: []
				)
			).toEqual([expect.stringContaining('"mode"')]);
		});

		it("should report nothing new when a broken config breaks the same way again", async () => {
			await write("/repo/default.rogen.json", { modes: {} });
			await start();

			await write("/repo/default.rogen.json", { modes: {} });
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(reload).toEqual({ changed: [], notices: [] });
		});

		it("should clear the errors, report a change and say it loads again once the file is fixed", async () => {
			await write("/repo/default.rogen.json", { name: "A" });
			await start();
			await write("/repo/default.rogen.json", { modes: {} });
			await selection.reload([onDisk("/repo/default.rogen.json")]);

			await write("/repo/default.rogen.json", { name: "C" });
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.projectName).toBe("C");
			expect(reload).toEqual({
				changed: ["/repo/default.rogen.json"],
				notices: [
					{ kind: "recovered", file: "/repo/default.rogen.json" },
				],
			});
		});

		it("should report a change when a config that was never valid becomes valid", async () => {
			await write("/repo/default.rogen.json", "{ nope");
			await start();

			await write("/repo/default.rogen.json", { name: "A" });
			const reload = await selection.reload([
				onDisk("/repo/default.rogen.json"),
			]);

			expect(resolved(0)?.projectName).toBe("A");
			expect(reload.changed).toEqual(["/repo/default.rogen.json"]);
		});

		it("should refuse both configs when a broken one beside another is fixed into its copy", async () => {
			const game = { name: "Game", routes: ROUTED };
			await write("/repo/game.rogen.json", game);
			await write("/repo/lobby.rogen.json", "{ nope");
			await start({ names: ["game"] });

			await write("/repo/lobby.rogen.json", game);
			const reload = await selection.reload([
				onDisk("/repo/lobby.rogen.json"),
			]);

			expect(errors(0).map(({ code }) => code)).toEqual([
				"config.identicalConfig",
			]);
			expect(reload.notices).toMatchObject([
				{ kind: "broken", file: "/repo/game.rogen.json" },
			]);
		});

		it("should ignore files no config reads", async () => {
			await write("/repo/default.rogen.json", {});
			await start();
			const [before] = selection.entries;

			await selection.reload([onDisk("/repo/unrelated.json")]);

			expect(selection.entries[0]).toBe(before);
		});
	});

	describe("reload of every config here", () => {
		it("should take up a config of any name that comes to the folder, and drop one that leaves it", async () => {
			await write("/repo/default.rogen.json", { routes: ROUTED });
			await write("/repo/lobby.rogen.json", {
				name: "Lobby",
				routes: ROUTED,
			});
			const here = await service.selectHere();

			await write("/repo/arena.rogen.json", {
				name: "Arena",
				routes: ROUTED,
			});
			await fs.delete("/repo/lobby.rogen.json");
			const reload = await here.reload([
				onDisk("/repo/arena.rogen.json"),
				onDisk("/repo/lobby.rogen.json"),
			]);

			expect(here.concerns(onDisk("/repo/arena.rogen.json"))).toBe(true);
			expect(here.concerns(onDisk("/repo/src/arena.rogen.json"))).toBe(
				false
			);
			expect(here.entries.map(({ file }) => file)).toEqual([
				"/repo/default.rogen.json",
				"/repo/arena.rogen.json",
			]);
			expect(reload.notices).toEqual([
				{ kind: "removed", file: "/repo/lobby.rogen.json" },
				{ kind: "added", file: "/repo/arena.rogen.json" },
			]);
		});
	});
});
