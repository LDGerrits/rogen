import { isIgnored } from "../ignored-paths.js";

describe("isIgnored", () => {
	it("should match the ignored path itself", () => {
		expect(isIgnored("/repo/out", ["/repo/out"])).toBe(true);
	});

	it("should match a path under an ignored directory", () => {
		expect(isIgnored("/repo/out/a/B.luau", ["/repo/out"])).toBe(true);
	});

	it("should not match a sibling that shares a name prefix", () => {
		expect(isIgnored("/repo/out-old/B.luau", ["/repo/out"])).toBe(false);
	});

	it("should match a path against a pattern in posix form", () => {
		expect(
			isIgnored("/repo/a.json.1.tmp", [/^\/repo\/a\.json\.[^/]+\.tmp$/])
		).toBe(true);
		expect(
			isIgnored("/repo/a.json", [/^\/repo\/a\.json\.[^/]+\.tmp$/])
		).toBe(false);
	});

	it("should not match anything when nothing is ignored", () => {
		expect(isIgnored("/repo/out", [])).toBe(false);
	});
});
