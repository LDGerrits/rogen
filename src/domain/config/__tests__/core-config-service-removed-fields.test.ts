import { errors, start, useConfigFixture, write } from "./config-fixture.js";

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("removed fields", () => {
		it("should say modes was removed, where it is written", async () => {
			await write(
				"/repo/rogen.json",
				`{
	"modes": { "dev": {} }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.removedField",
					position: { line: 2, column: 2 },
					message: expect.stringContaining('"modes" was removed.'),
				},
			]);
		});

		it.each([
			"mode",
			"variants",
			"conflicts",
			"server",
			"extends",
			"template",
			"outFile",
			"exclude",
			"rootDirs",
			"syncDir",
		])("should say %s was removed", async (field) => {
			await write("/repo/rogen.json", { [field]: "x" });

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.removedField",
					message: expect.stringContaining(`"${field}" was removed.`),
				},
			]);
		});

		it("should name a later source path as what replaces a variant", async () => {
			await write("/repo/rogen.json", { variants: { mock: true } });

			await start();

			expect(errors(0)[0].message).toContain("later source path");
		});

		it("should name globIgnorePaths as what replaces exclude", async () => {
			await write("/repo/rogen.json", { exclude: ["**/*.spec.luau"] });

			await start();

			expect(errors(0)[0].message).toContain('"globIgnorePaths"');
		});

		it("should report every removed field at once", async () => {
			await write("/repo/rogen.json", { extends: "x", template: "y" });

			await start();

			expect(errors(0)).toHaveLength(2);
		});
	});
});
