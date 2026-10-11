import {
	useConfigFixture,
	fs,
	selection,
	write,
	start,
	resolved,
	errors,
} from "./config-fixture.js";

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("reload of every config here", () => {
		beforeEach(async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
		});

		it("should know the folder it was picked from, and not when configs were named", async () => {
			await start({ names: [] });
			expect(selection.followedFolder).toBe("/repo");

			await start({ names: ["default"] });
			expect(selection.followedFolder).toBeUndefined();
		});

		it("should concern the config files of that folder and the files it reads", async () => {
			await start({ names: [] });

			expect(selection.concerns("/repo/new.rogen.json")).toBe(true);
			expect(selection.concerns("/repo/default.rogen.json")).toBe(true);
			expect(selection.concerns("/repo/src/x.rogen.json")).toBe(false);
			expect(selection.concerns("/repo/README.md")).toBe(false);
		});

		it("should pick up a config added to the folder, and report it", async () => {
			await start({ names: [] });

			await write("/repo/lobby.rogen.json", { rootDirs: ["b"] });
			const reload = await selection.reload(["/repo/lobby.rogen.json"]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.rogen.json",
				"/repo/lobby.rogen.json",
			]);
			expect(reload.changed).toEqual(["/repo/lobby.rogen.json"]);
			expect(reload.notices).toEqual([
				{ kind: "added", file: "/repo/lobby.rogen.json" },
			]);
			expect(selection.files.has("/repo/lobby.rogen.json")).toBe(true);
		});

		it("should report a config added broken with its errors, which no earlier version stands in for", async () => {
			await start({ names: [] });

			await write("/repo/lobby.rogen.json", { bogus: 1 });
			const reload = await selection.reload(["/repo/lobby.rogen.json"]);

			expect(selection.entries[1].status).toBe("broken");
			expect(reload.changed).toEqual([]);
			expect(reload.notices).toMatchObject([
				{
					kind: "broken",
					file: "/repo/lobby.rogen.json",
					keptLastValid: false,
				},
			]);
		});

		it("should drop a config deleted from the folder, and report it", async () => {
			await write("/repo/lobby.rogen.json", {});
			await start({ names: [] });

			await fs.delete("/repo/lobby.rogen.json");
			const reload = await selection.reload(["/repo/lobby.rogen.json"]);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.rogen.json",
			]);
			expect(reload.notices).toEqual([
				{ kind: "removed", file: "/repo/lobby.rogen.json" },
			]);
			expect(selection.files.has("/repo/lobby.rogen.json")).toBe(false);
		});

		it("should be left with no config when the last one is deleted", async () => {
			await start({ names: [] });

			await fs.delete("/repo/default.rogen.json");
			await selection.reload(["/repo/default.rogen.json"]);

			expect(selection.entries).toEqual([]);
		});

		it("should not look for new configs when the selection named its configs", async () => {
			await start({ names: ["default"] });

			await write("/repo/lobby.rogen.json", {});
			const reload = await selection.reload(["/repo/lobby.rogen.json"]);

			expect(selection.entries).toHaveLength(1);
			expect(reload).toEqual({ changed: [], notices: [] });
		});
	});

	describe("reload", () => {
		it("should report each config whose value changed, in selection order", async () => {
			await write("/repo/base.rogen.json", { rootDirs: ["a"] });
			await write("/repo/one.rogen.json", {
				extends: "./base.rogen.json",
			});
			await write("/repo/two.rogen.json", {
				extends: "./base.rogen.json",
			});
			await write("/repo/other.rogen.json", { rootDirs: ["z"] });
			await start({ names: ["one", "two", "other"] });

			await write("/repo/base.rogen.json", { rootDirs: ["b"] });
			const reload = await selection.reload(["/repo/base.rogen.json"]);

			expect(reload).toEqual({
				changed: ["/repo/one.rogen.json", "/repo/two.rogen.json"],
				notices: [],
			});
			expect(resolved(0)?.rootDirs).toEqual(["/repo/b"]);
			expect(resolved(2)?.rootDirs).toEqual(["/repo/z"]);
		});

		it("should report nothing when the resolved value is unchanged", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start();

			await write("/repo/default.rogen.json", {
				rootDirs: ["a"],
			});
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(reload).toEqual({ changed: [], notices: [] });
		});

		it("should report a config whose routes only changed order, since their order is their precedence", async () => {
			await write("/repo/default.rogen.json", {
				rootDirs: ["a"],
				routes: { server: "ServerScriptService", client: "StarterGui" },
			});
			await start();

			await write("/repo/default.rogen.json", {
				rootDirs: ["a"],
				routes: { client: "StarterGui", server: "ServerScriptService" },
			});
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(reload.changed).toEqual(["/repo/default.rogen.json"]);
		});

		it("should keep the same config when a reload loads it unchanged, even after it broke", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start();
			const before = resolved(0);

			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await selection.reload(["/repo/default.rogen.json"]);
			expect(resolved(0)).toBe(before);

			await fs.writeFile("/repo/default.rogen.json", "{ nope");
			await selection.reload(["/repo/default.rogen.json"]);
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await selection.reload(["/repo/default.rogen.json"]);
			expect(resolved(0)).toBe(before);
		});

		it("should keep the last valid value when a reload breaks the config, and report the new errors", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start();

			await write(
				"/repo/default.rogen.json",
				`{
	"rootDirs": ["b"],
	"bogus": 1
}`
			);
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(resolved(0)?.rootDirs).toEqual(["/repo/a"]);
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
			await write("/repo/default.rogen.json", { bogus: 1 });
			await start();

			await write("/repo/default.rogen.json", { bogus: 1, other: 2 });
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(errors(0)).toHaveLength(2);
			expect(
				reload.notices.flatMap((notice) =>
					notice.kind === "broken"
						? notice.errors.map(({ message }) => message)
						: []
				)
			).toEqual([expect.stringContaining('"other"')]);
		});

		it("should report nothing new when a broken config breaks the same way again", async () => {
			await write("/repo/default.rogen.json", { bogus: 1 });
			await start();

			await write("/repo/default.rogen.json", { bogus: 1 });
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(reload).toEqual({ changed: [], notices: [] });
		});

		it("should clear the errors, report a change and say it loads again once the file is fixed", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start();
			await write("/repo/default.rogen.json", { bogus: 1 });
			await selection.reload(["/repo/default.rogen.json"]);

			await write("/repo/default.rogen.json", { rootDirs: ["c"] });
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.rootDirs).toEqual(["/repo/c"]);
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

			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			const reload = await selection.reload(["/repo/default.rogen.json"]);

			expect(resolved(0)?.rootDirs).toEqual(["/repo/a"]);
			expect(reload.changed).toEqual(["/repo/default.rogen.json"]);
		});

		it("should ignore files no config reads", async () => {
			await write("/repo/default.rogen.json", {});
			await start();
			const [before] = selection.entries;

			await selection.reload(["/repo/unrelated.json"]);

			expect(selection.entries[0]).toBe(before);
		});

		it("should start watching the files a reload begins to read", async () => {
			await write("/repo/base.rogen.json", {});
			await write("/repo/default.rogen.json", {});
			await start();

			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});
			await selection.reload(["/repo/default.rogen.json"]);

			expect(selection.files).toEqual(
				new Set(["/repo/default.rogen.json", "/repo/base.rogen.json"])
			);
		});
	});
});
