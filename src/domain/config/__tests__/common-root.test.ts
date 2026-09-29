import path from "path";
import { commonRoot } from "../common-root.js";

const abs = (...segments: string[]) => path.resolve("/repo", ...segments);

describe("commonRoot", () => {
	it("should be the root dir itself when there is one", () => {
		expect(commonRoot([abs("src")])).toBe(abs("src"));
	});

	it("should be the shared parent of sibling root dirs", () => {
		expect(commonRoot([abs("core"), abs("lobby")])).toBe(abs("."));
	});

	it("should be the deepest directory containing every root dir", () => {
		expect(
			commonRoot([abs("places/main/src"), abs("places/common/src")])
		).toBe(abs("places"));
	});

	it("should not match on a shared name prefix that is not a whole segment", () => {
		expect(commonRoot([abs("src"), abs("src-extra")])).toBe(abs("."));
	});

	it("should throw when there are no root dirs", () => {
		expect(() => commonRoot([])).toThrow();
	});
});
