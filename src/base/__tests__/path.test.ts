import path from "path";
import { isInside, toPosix } from "../path.js";

describe("Path", () => {
	describe("toPosix", () => {
		it("should convert Windows backslashes to forward slashes", () => {
			const mockWindowsPath = `src${path.sep}core${path.sep}module.ts`;
			expect(toPosix(mockWindowsPath)).toBe("src/core/module.ts");
		});

		it("should return POSIX paths unmodified", () => {
			expect(toPosix("src/core/module.ts")).toBe("src/core/module.ts");
		});
	});

	describe("isInside", () => {
		const abs = (...segments: string[]) =>
			path.resolve("/repo", ...segments);

		it("should accept a nested dir", () => {
			expect(isInside(abs("src/shared"), abs("src"))).toBe(true);
		});

		it("should reject the same dir", () => {
			expect(isInside(abs("src"), abs("src"))).toBe(false);
		});

		it("should reject a sibling that shares a name prefix", () => {
			expect(isInside(abs("src-extra"), abs("src"))).toBe(false);
		});

		it("should reject a parent", () => {
			expect(isInside(abs("src"), abs("src/shared"))).toBe(false);
		});

		it("should accept a dir whose name starts with two dots", () => {
			expect(isInside(abs("src/..hidden"), abs("src"))).toBe(true);
		});
	});
});
