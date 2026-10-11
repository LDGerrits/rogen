import { Version } from "../version.js";

const v = (text: string) => Version.parse(text)!;

describe("Version", () => {
	describe("parse", () => {
		it.each(["2.0.0", "v2.0.0", "2.0.0-beta.1", "2.0.0+build.5"])(
			"should read %s",
			(text) => {
				expect(Version.parse(text)).toBeDefined();
			}
		);

		it.each(["unknown", "2.0", "2.0.0.1", "", "nightly"])(
			"should not read %s",
			(text) => {
				expect(Version.parse(text)).toBeUndefined();
			}
		);

		it("should print without the v and the build metadata", () => {
			expect(v("v2.0.1-beta.2+sha").toString()).toBe("2.0.1-beta.2");
		});
	});

	describe("isPrerelease", () => {
		it("should be true after a dash only", () => {
			expect(v("2.0.0-beta.1").isPrerelease).toBe(true);
			expect(v("2.0.0").isPrerelease).toBe(false);
		});
	});

	describe("compareTo", () => {
		it.each([
			["2.0.1", "2.0.0"],
			["2.1.0", "2.0.9"],
			["10.0.0", "9.9.9"],
			["2.0.0", "2.0.0-beta.1"],
			["2.0.0-beta.2", "2.0.0-beta.1"],
			["2.0.0-beta.10", "2.0.0-beta.9"],
			["2.0.0-beta", "2.0.0-alpha"],
			["2.0.0-beta.1", "2.0.0-beta"],
			["2.0.0-alpha", "2.0.0-1"],
		])("should order %s after %s", (newer, older) => {
			expect(v(newer).compareTo(v(older))).toBeGreaterThan(0);
			expect(v(older).compareTo(v(newer))).toBeLessThan(0);
		});

		it("should call the same release equal", () => {
			expect(v("2.0.0").compareTo(v("v2.0.0+x"))).toBe(0);
			expect(v("2.0.0-beta.1").compareTo(v("2.0.0-beta.1"))).toBe(0);
		});
	});
});
