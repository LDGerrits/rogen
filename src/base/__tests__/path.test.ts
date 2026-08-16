import path from "path";
import { toPosix } from "../path.js";

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
});
