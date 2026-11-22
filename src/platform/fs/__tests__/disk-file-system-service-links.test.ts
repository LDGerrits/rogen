import { jest } from "@jest/globals";
import { createRequire } from "module";
import path from "path";

const actual = createRequire(import.meta.url)("fs") as typeof import("fs");
const link = path.resolve("/repo/places/link");

jest.unstable_mockModule("fs", () => ({
	...actual,
	lstatSync: () => ({ isSymbolicLink: () => true }),
	realpathSync: (target: string) => {
		if (target === link) return path.resolve("/repo");
		throw Object.assign(new Error("EACCES"), { code: "EACCES" });
	},
}));

const { isUnfollowableLink } = await import("../disk-file-system-service.js");

describe("isUnfollowableLink", () => {
	it("should follow a link whose folders can't be resolved, rather than throw", () => {
		expect(isUnfollowableLink(link)).toBe(false);
	});
});
