import { describeWithSource, rojoSource } from "./rojo-source.js";
import { RojoFile } from "../rojo.js";
import { DEFAULT_SYNC_RULES, SyncRule, SyncRules } from "../sync-rules.js";

describe("domain/rojo/sync-rules", () => {
	describe("SyncRules", () => {
		describe("match", () => {
			it.each([
				["Save.luau", "moduleScript", "Save"],
				["Save.lua", "moduleScript", "Save"],
				["Hit.mock.luau", "moduleScript", "Hit.mock"],
				["Save.server.luau", "serverScript", "Save"],
				["Save.server.lua", "serverScript", "Save"],
				["Hud.client.luau", "clientScript", "Hud"],
				["Tool.plugin.lua", "pluginScript", "Tool"],
				["Gun.model.json", "jsonModel", "Gun"],
				["Gun.model.jsonc", "jsonModel", "Gun"],
				["Sub.project.json", "project", "Sub"],
				["Sub.project.jsonc", "project", "Sub"],
				["Config.json", "json", "Config"],
				["Config.jsonc", "json", "Config"],
				["Config.toml", "toml", "Config"],
				["Table.csv", "csv", "Table"],
				["Notes.txt", "text", "Notes"],
				["Part.rbxm", "rbxm", "Part"],
				["Part.rbxmx", "rbxmx", "Part"],
				["Config.yaml", "yaml", "Config"],
				["Config.yml", "yaml", "Config"],
			])("should read %s as %s named %s", (fileName, use, name) => {
				const match = SyncRules.DEFAULT.match(fileName);

				expect(match?.rule.use).toBe(use);
				expect(match?.name).toBe(name);
			});

			it.each([
				"Save.meta.json",
				"Save.meta.jsonc",
				"Notes.md",
				"README",
				"Save.LUAU",
				"Types.d.ts",
				"Save.ts",
			])("should read nothing in %s", (fileName) => {
				expect(SyncRules.DEFAULT.match(fileName)).toBeUndefined();
			});

			it("should match across folders", () => {
				expect(SyncRules.DEFAULT.match("a/b/Save.luau")?.rule.use).toBe(
					"moduleScript"
				);
			});

			it("should take the first rule that matches", () => {
				const rules = new SyncRules([
					{ pattern: "*.md", use: "text" },
					{ pattern: "*.md", use: "json" },
				]);

				expect(rules.match("A.md")?.rule.use).toBe("text");
			});

			it("should skip a rule whose exclude matches", () => {
				const rules = new SyncRules([
					{ pattern: "*.md", exclude: "*.draft.md", use: "text" },
				]);

				expect(rules.match("A.draft.md")).toBeUndefined();
				expect(rules.match("A.md")?.name).toBe("A");
			});

			it("should cut the whole suffix off the name", () => {
				const rules = new SyncRules([
					{
						pattern: "*.module.luau",
						use: "moduleScript",
						suffix: ".module.luau",
					},
				]);

				expect(rules.match("Foo.module.luau")?.name).toBe("Foo");
			});

			it("should keep the whole file name when it does not end with the suffix", () => {
				const rules = new SyncRules([
					{ pattern: "*.md", use: "text", suffix: ".txt" },
				]);

				expect(rules.match("Foo.md")?.name).toBe("Foo.md");
			});

			it("should cut only the last extension when the rule has no suffix", () => {
				const rules = new SyncRules([{ pattern: "*.md", use: "text" }]);

				expect(rules.match("a.b.md")?.name).toBe("a.b");
				expect(rules.match(".md")?.name).toBe(".md");
			});

			it("should name a file by its own name when it lies in a folder", () => {
				expect(
					SyncRules.DEFAULT.match("dir/Save.server.luau")?.name
				).toBe("Save");
			});
		});

		describe("following", () => {
			it("should put the rules it is given in front of Rojo's", () => {
				const rules = SyncRules.following(
					[
						{
							pattern: "*.spec.luau",
							use: "text",
							suffix: ".spec.luau",
						},
					],
					"/repo"
				);

				expect(rules.match("A.spec.luau")).toMatchObject({
					rule: { use: "text" },
					name: "A",
					own: true,
				});
				expect(rules.match("A.luau")).toMatchObject({
					rule: { use: "moduleScript" },
					own: false,
				});
			});

			it("should list only the rules it was given as its own", () => {
				const own: SyncRule[] = [{ pattern: "*.md", use: "text" }];

				expect(SyncRules.following(own, "/repo").own).toEqual(own);
				expect(SyncRules.DEFAULT.own).toEqual([]);
			});

			it("should say when the suffix of a rule does not end the file name", () => {
				const rules = SyncRules.following(
					[{ pattern: "*.md", use: "text", suffix: ".txt" }],
					"/repo"
				);

				expect(rules.match("Foo.md")?.suffixMissed).toBe(true);
				expect(rules.match("Foo.luau")?.suffixMissed).toBe(false);
			});
		});

		describe("read", () => {
			it("should read every field of a rule", () => {
				const written = {
					pattern: "*.rojo",
					exclude: "*.ignore.rojo",
					use: "project",
					suffix: ".rojo",
				};

				expect(SyncRules.read([written])).toEqual({
					rules: [written],
					problems: [],
				});
			});

			it.each([
				["a rule that is not an object", "x"],
				["a rule without a pattern", { use: "text" }],
				["a pattern that is not a string", { pattern: 1, use: "text" }],
				["a rule without a use", { pattern: "*.md" }],
				["a use Rojo does not have", { pattern: "*.md", use: "stone" }],
				[
					"an exclude that is not a string",
					{ pattern: "*.md", use: "text", exclude: 1 },
				],
				[
					"a suffix that is not a string",
					{ pattern: "*.md", use: "text", suffix: 1 },
				],
			])("should report %s", (_, rule) => {
				const read = SyncRules.read([
					{ pattern: "*.ok", use: "text" },
					rule,
				]);

				expect(read.rules).toHaveLength(1);
				expect(read.problems).toEqual([
					{ index: 1, message: expect.any(String) },
				]);
			});
		});

		describe("in front of the defaults", () => {
			it("should let a rule placed first win over the defaults", () => {
				const rules = new SyncRules([
					{
						pattern: "*.spec.luau",
						use: "text",
						suffix: ".spec.luau",
					},
					...DEFAULT_SYNC_RULES,
				]);

				expect(rules.match("A.spec.luau")?.rule.use).toBe("text");
				expect(rules.match("A.luau")?.rule.use).toBe("moduleScript");
			});
		});
	});

	const source = rojoSource("src/snapshot_middleware/mod.rs");
	const describeWithRojoSource = describeWithSource(source);

	describeWithRojoSource("DEFAULT_SYNC_RULES", () => {
		it("should list the rules of the pinned Rojo, in its order", () => {
			expect(DEFAULT_SYNC_RULES).toEqual(rulesIn(source ?? ""));
		});
	});

	describeWithRojoSource("RojoFile.INIT_FILES", () => {
		it("should list the init files of the pinned Rojo", () => {
			expect([...RojoFile.INIT_FILES].sort()).toEqual(
				initFilesIn(source ?? "").sort()
			);
		});
	});
});

const SYNC_RULE_MACRO =
	/sync_rule!\(\s*"([^"]+)"\s*,\s*(\w+)\s*(?:,\s*"([^"]+)"\s*)?(?:,\s*"([^"]+)"\s*)?\)/g;

const USES: Readonly<Record<string, SyncRule["use"]>> = {
	ServerScript: "serverScript",
	ClientScript: "clientScript",
	PluginScript: "pluginScript",
	ModuleScript: "moduleScript",
	Project: "project",
	JsonModel: "jsonModel",
	Json: "json",
	Toml: "toml",
	Csv: "csv",
	Text: "text",
	Rbxmx: "rbxmx",
	Rbxm: "rbxm",
	Yaml: "yaml",
};

function rulesIn(source: string): SyncRule[] {
	const body = source.slice(source.indexOf("pub fn default_sync_rules"));
	return [...body.matchAll(SYNC_RULE_MACRO)].map(
		([, pattern, middleware, suffix, exclude]) => ({
			pattern,
			...(exclude && { exclude }),
			use: USES[middleware],
			...(suffix && { suffix }),
		})
	);
}

function initFilesIn(source: string): string[] {
	const body = source.slice(source.indexOf("INIT_PATHS"));
	const list = body.slice(0, body.indexOf("]"));
	return [...list.matchAll(/Middleware::\w+,\s*"([^"]+)"/g)].map(
		([, file]) => file
	);
}
