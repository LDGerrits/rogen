import { ConfigKeys } from "../config-keys.js";

describe("domain/config/config-keys", () => {
	describe("ConfigKeys.check", () => {
		const location = {
			resource: "/repo/default.rogen.json",
			position: { line: 3, column: 5 },
		};
		const check = (...keys: string[]) =>
			ConfigKeys.check(keys, () => location);

		it.each(["exlude", "toString", "rogen", "extends"])(
			"should refuse %s, a key neither Rojo's nor Rogen's",
			(key) => {
				expect(check(key)).toMatchObject([
					{ code: "config.unknownField" },
				]);
			}
		);

		it.each(["$schema", "name", "tree", "routes", "compiledPath"])(
			"should accept %s",
			(key) => {
				expect(check(key)).toEqual([]);
			}
		);

		it("should offer the closest key as a replacement", () => {
			expect(check("sourcePath")[0]).toMatchObject({
				message: expect.stringContaining('Did you mean "sourcePaths"?'),
				fixes: [
					{ replace: { from: '"sourcePath"', to: '"sourcePaths"' } },
				],
			});
		});

		it("should not offer a key the file has already", () => {
			expect(check("sourcePaths", "sourcePath")[0].message).not.toContain(
				"Did you mean"
			);
		});
	});
});
