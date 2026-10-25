import { ConfigKeys } from "../config-keys.js";

describe("domain/config/config-keys", () => {
	describe("ConfigKeys.check", () => {
		const location = { resource: "/repo/default.rogen.json" };
		const check = (key: string) => ConfigKeys.check([key], () => location);

		it.each([
			"modes",
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
			"syncPath",
			"rogen",
		])("should say %s was removed and what to do instead", (key) => {
			expect(check(key)).toMatchObject([
				{
					code: "config.removedField",
					message: expect.stringContaining(`"${key}" was removed.`),
				},
			]);
		});

		it("should say a rogen block's keys go at the top level", () => {
			expect(check("rogen")[0].message).toContain("top level");
		});

		it("should say how to serve with Argon for server", () => {
			expect(check("server")[0].message).toContain("argon serve");
		});

		it("should name the replacement of exclude, and what it does to a mount", () => {
			expect(check("exclude")[0].message).toContain('"globIgnorePaths"');
			expect(check("exclude")[0].message).toContain("leaves out a mount");
		});

		it.each(["exlude", "toString"])(
			"should leave %s to the unknown key error",
			(key) => {
				expect(check(key)).toMatchObject([
					{ code: "config.unknownField" },
				]);
			}
		);

		it("should accept $schema as one of Rojo's keys", () => {
			expect(check("$schema")).toEqual([]);
		});

		const keyLocation = {
			resource: "/repo/default.rogen.json",
			position: { line: 3, column: 5 },
		};

		it.each(["outDir", "outputPath"])(
			"should offer compiledPath for %s, the usual try for it",
			(key) => {
				const [diagnostic] = ConfigKeys.check([key], () => keyLocation);

				expect(diagnostic).toMatchObject({
					code: "config.unknownField",
					message: expect.stringContaining(
						'Did you mean "compiledPath"?'
					),
					fixes: [
						{ replace: { from: `"${key}"`, to: '"compiledPath"' } },
					],
				});
			}
		);

		it("should not offer compiledPath when the file has it already", () => {
			const diagnostics = ConfigKeys.check(
				["compiledPath", "outDir"],
				() => keyLocation
			);

			expect(diagnostics[0].message).not.toContain("compiledPath");
		});
	});
});
