import {
	useConfigFixture,
	fs,
	selection,
	write,
	start,
	resolved,
	errors,
} from "./config-fixture.js";

const ROUTED = { server: "ServerScriptService" };

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("reload of the config here", () => {
		beforeEach(async () => {
			await write("/repo/rogen.json", {
				routes: ROUTED,
				sourcePaths: ["a"],
			});
		});

		it("should know the folder it was picked from, and not when configs were named", async () => {
			await start();
			expect(selection.followedFolder).toBe("/repo");

			await start({ names: ["."] });
			expect(selection.followedFolder).toBeUndefined();
		});

		it("should concern the config files of that folder and the files it reads", async () => {
			await start();

			expect(selection.concerns("/repo/rogen.json")).toBe(true);
			expect(selection.concerns("/repo/rogen.jsonc")).toBe(true);
			expect(selection.concerns("/repo/src/rogen.json")).toBe(false);
			expect(selection.concerns("/repo/README.md")).toBe(false);
		});

		it("should drop a config deleted from the folder, and report it", async () => {
			await start();

			await fs.delete("/repo/rogen.json");
			const reload = await selection.reload(["/repo/rogen.json"]);

			expect(selection.entries).toEqual([]);
			expect(reload.notices).toEqual([
				{ kind: "removed", file: "/repo/rogen.json" },
			]);
			expect(selection.files.has("/repo/rogen.json")).toBe(false);
		});

		it("should pick up a config that comes back to the folder, and report it", async () => {
			await start();
			await fs.delete("/repo/rogen.json");
			await selection.reload(["/repo/rogen.json"]);

			await write("/repo/rogen.json", { routes: ROUTED });
			const reload = await selection.reload(["/repo/rogen.json"]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/rogen.json",
			]);
			expect(reload.changed).toEqual(["/repo/rogen.json"]);
			expect(reload.notices).toEqual([
				{ kind: "added", file: "/repo/rogen.json" },
			]);
		});

		it("should report a config that comes back broken with its errors, which no earlier version stands in for", async () => {
			await start();
			await fs.delete("/repo/rogen.json");
			await selection.reload(["/repo/rogen.json"]);

			await write("/repo/rogen.json", { modes: {} });
			const reload = await selection.reload(["/repo/rogen.json"]);

			expect(selection.entries[0].status).toBe("broken");
			expect(reload.changed).toEqual([]);
			expect(reload.notices).toMatchObject([
				{
					kind: "broken",
					file: "/repo/rogen.json",
					keptLastValid: false,
				},
			]);
		});

		it("should keep the config it has when a second config file appears beside it", async () => {
			await start();

			await write("/repo/rogen.jsonc", { routes: ROUTED });
			const reload = await selection.reload(["/repo/rogen.jsonc"]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/rogen.json",
			]);
			expect(reload).toEqual({ changed: [], notices: [] });
		});

		it("should not look for new configs when the selection named its configs", async () => {
			await write("/repo/lobby/rogen.json", {});
			await start({ names: ["lobby"] });

			await write("/repo/lobby/rogen.jsonc", {});
			const reload = await selection.reload(["/repo/lobby/rogen.jsonc"]);

			expect(selection.entries).toHaveLength(1);
			expect(reload).toEqual({ changed: [], notices: [] });
		});
	});

	describe("reload", () => {
		it("should report each config whose value changed, in selection order", async () => {
			await write("/repo/one/rogen.json", {
				routes: ROUTED,
				sourcePaths: ["a"],
			});
			await write("/repo/two/rogen.json", {
				routes: ROUTED,
				sourcePaths: ["z"],
			});
			await start({ names: ["one", "two"] });

			await write("/repo/one/rogen.json", {
				routes: ROUTED,
				sourcePaths: ["b"],
			});
			const reload = await selection.reload(["/repo/one/rogen.json"]);

			expect(reload).toEqual({
				changed: ["/repo/one/rogen.json"],
				notices: [],
			});
			expect(resolved(0)?.sourcePaths).toEqual(["/repo/one/b"]);
			expect(resolved(1)?.sourcePaths).toEqual(["/repo/two/z"]);
		});

		it("should report nothing when the resolved value is unchanged", async () => {
			await write("/repo/rogen.json", { name: "A" });
			await start();

			await write("/repo/rogen.json", { name: "A" });
			const reload = await selection.reload(["/repo/rogen.json"]);

			expect(reload).toEqual({ changed: [], notices: [] });
		});

		it("should report a change to the tree", async () => {
			await write("/repo/rogen.json", {
				tree: { $className: "DataModel" },
			});
			await start();

			await write("/repo/rogen.json", {
				tree: { $className: "DataModel", Workspace: {} },
			});
			const reload = await selection.reload(["/repo/rogen.json"]);

			expect(reload.changed).toEqual(["/repo/rogen.json"]);
		});

		it("should report a config whose routes only changed order, since their order is their precedence", async () => {
			await write("/repo/rogen.json", {
				routes: { server: "ServerScriptService", client: "StarterGui" },
			});
			await start();

			await write("/repo/rogen.json", {
				routes: { client: "StarterGui", server: "ServerScriptService" },
			});
			const reload = await selection.reload(["/repo/rogen.json"]);

			expect(reload.changed).toEqual(["/repo/rogen.json"]);
		});

		it("should keep the same config when a reload loads it unchanged, even after it broke", async () => {
			await write("/repo/rogen.json", { name: "A" });
			await start();
			const before = resolved(0);

			await write("/repo/rogen.json", { name: "A" });
			await selection.reload(["/repo/rogen.json"]);
			expect(resolved(0)).toBe(before);

			await fs.writeFile("/repo/rogen.json", "{ nope");
			await selection.reload(["/repo/rogen.json"]);
			await write("/repo/rogen.json", { name: "A" });
			await selection.reload(["/repo/rogen.json"]);
			expect(resolved(0)).toBe(before);
		});

		it("should keep the last valid value when a reload breaks the config, and report the new errors", async () => {
			await write("/repo/rogen.json", { name: "A" });
			await start();

			await write(
				"/repo/rogen.json",
				`{
	"name": "B",
	"modes": {}
}`
			);
			const reload = await selection.reload(["/repo/rogen.json"]);

			expect(resolved(0)?.projectName).toBe("A");
			expect(errors(0)).toMatchObject([
				{
					code: "config.removedField",
					position: { line: 3, column: 2 },
				},
			]);
			expect(reload.changed).toEqual([]);
			expect(reload.notices).toEqual([
				{
					kind: "broken",
					file: "/repo/rogen.json",
					errors: errors(0),
					keptLastValid: true,
				},
			]);
		});

		it("should report only the errors the previous load didn't have", async () => {
			await write("/repo/rogen.json", { modes: {} });
			await start();

			await write("/repo/rogen.json", { modes: {}, mode: "x" });
			const reload = await selection.reload(["/repo/rogen.json"]);

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
			await write("/repo/rogen.json", { modes: {} });
			await start();

			await write("/repo/rogen.json", { modes: {} });
			const reload = await selection.reload(["/repo/rogen.json"]);

			expect(reload).toEqual({ changed: [], notices: [] });
		});

		it("should clear the errors, report a change and say it loads again once the file is fixed", async () => {
			await write("/repo/rogen.json", { name: "A" });
			await start();
			await write("/repo/rogen.json", { modes: {} });
			await selection.reload(["/repo/rogen.json"]);

			await write("/repo/rogen.json", { name: "C" });
			const reload = await selection.reload(["/repo/rogen.json"]);

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.projectName).toBe("C");
			expect(reload).toEqual({
				changed: ["/repo/rogen.json"],
				notices: [{ kind: "recovered", file: "/repo/rogen.json" }],
			});
		});

		it("should report a change when a config that was never valid becomes valid", async () => {
			await write("/repo/rogen.json", "{ nope");
			await start();

			await write("/repo/rogen.json", { name: "A" });
			const reload = await selection.reload(["/repo/rogen.json"]);

			expect(resolved(0)?.projectName).toBe("A");
			expect(reload.changed).toEqual(["/repo/rogen.json"]);
		});

		it("should ignore files no config reads", async () => {
			await write("/repo/rogen.json", {});
			await start();
			const [before] = selection.entries;

			await selection.reload(["/repo/unrelated.json"]);

			expect(selection.entries[0]).toBe(before);
		});
	});
});
