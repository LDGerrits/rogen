import { describeWithSource, rojoSource } from "./rojo-source.js";
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

/** The rules `default_sync_rules` lists in `source`. */
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
