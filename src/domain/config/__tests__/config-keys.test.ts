import { ConfigKeys } from "../config-keys.js";

describe("domain/config/config-keys", () => {
	describe("ConfigKeys.check", () => {
		const location = { resource: "/repo/default.rogen.json" };
		const check = (key: string) =>
			ConfigKeys.check([key], () => location, false);

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
		])("should say %s was removed and what to do instead", (key) => {
			expect(check(key)).toMatchObject([
				{
					code: "config.removedField",
					message: expect.stringContaining(`"${key}" was removed.`),
				},
			]);
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
	});
});
