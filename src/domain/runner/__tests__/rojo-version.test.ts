import { RojoVersion } from "../rojo-version.js";

describe("RojoVersion", () => {
	describe("parse", () => {
		it("should read the version out of what `rojo --version` prints", () => {
			expect(RojoVersion.parse("Rojo 7.7.1\n")?.toString()).toBe("7.7.1");
			expect(RojoVersion.parse("7.5.0-rc.2")?.toString()).toBe("7.5.0");
			expect(RojoVersion.parse("7.7")?.toString()).toBe("7.7.0");
		});

		it("should read nothing from text without a version", () => {
			expect(RojoVersion.parse("Rojo")).toBeUndefined();
			expect(RojoVersion.parse("7")).toBeUndefined();
		});
	});

	describe("isBefore", () => {
		it.each([
			["7.4.4", "7.5.0", true],
			["7.5.0", "7.5.0", false],
			["7.5.1", "7.5.0", false],
			["7.10.0", "7.5.0", false],
			["6.9.9", "7.0.0", true],
			["8.0.0", "7.9.9", false],
			["7.7.0", "7.7.1", true],
		])("should tell whether %s is before %s", (version, other, before) => {
			expect(
				RojoVersion.parse(version)?.isBefore(RojoVersion.of(other))
			).toBe(before);
		});
	});
});
