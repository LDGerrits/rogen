import { PathRebaser } from "../path-rebaser.js";

describe("PathRebaser", () => {
	describe("path", () => {
		it("should write a path relative to the other folder", () => {
			expect(
				PathRebaser.path("vendor", "/repo", "/repo/places/lobby")
			).toBe("../../vendor");
			expect(
				PathRebaser.path("src/a", "/repo/shared", "/repo/places/lobby")
			).toBe("../../shared/src/a");
		});

		it("should write a path below the other folder without a leading dot", () => {
			expect(
				PathRebaser.path("places/lobby/src", "/repo", "/repo/places")
			).toBe("lobby/src");
		});

		it("should write a path to the folder itself as a dot", () => {
			expect(PathRebaser.path(".", "/repo", "/repo")).toBe(".");
		});

		it("should leave an absolute path alone", () => {
			expect(PathRebaser.path("/opt/vendor", "/repo", "/repo/a")).toBe(
				"/opt/vendor"
			);
		});
	});

	describe("syncRules", () => {
		it("should leave the sync rules as they are", () => {
			const rules = [{ pattern: "*.md", use: "text" }];

			expect(
				PathRebaser.values(
					{ syncRules: rules },
					"/repo",
					"/repo/places/lobby"
				).syncRules
			).toEqual(rules);
		});
	});

	describe("glob", () => {
		it("should match the same files from the other folder", () => {
			expect(
				PathRebaser.glob(
					"**/*.spec.luau",
					"/repo",
					"/repo/places/lobby"
				)
			).toBe("../../**/*.spec.luau");
		});

		it("should rebase a ! glob behind its !", () => {
			expect(
				PathRebaser.glob(
					"!src/Keep.luau",
					"/repo",
					"/repo/places/lobby"
				)
			).toBe("!../../src/Keep.luau");
		});

		it("should leave a glob alone for the same folder", () => {
			expect(PathRebaser.glob("src/**", "/repo", "/repo")).toBe("src/**");
		});

		it("should leave an absolute glob alone", () => {
			expect(PathRebaser.glob("/abs/vendor/**", "/repo", "/repo/a")).toBe(
				"/abs/vendor/**"
			);
		});
	});

	describe("values", () => {
		const values = {
			name: "Game",
			tree: {
				$className: "DataModel",
				ReplicatedStorage: {
					Vendor: { $path: "vendor" },
					Packages: { $path: { optional: "Packages" } },
					Gone: null,
					$properties: { Name: "x" },
				},
			},
			globIgnorePaths: ["**/*.spec.luau"],
			syncPath: "dist",
			servePort: 34872,
		};

		it("should rebase the paths of the tree, the globs and the sync path", () => {
			expect(
				PathRebaser.values(values, "/repo", "/repo/places/lobby")
			).toEqual({
				name: "Game",
				tree: {
					$className: "DataModel",
					ReplicatedStorage: {
						Vendor: { $path: "../../vendor" },
						Packages: { $path: { optional: "../../Packages" } },
						Gone: null,
						$properties: { Name: "x" },
					},
				},
				globIgnorePaths: ["../../**/*.spec.luau"],
				syncPath: "../../dist",
				servePort: 34872,
			});
		});

		it("should leave what it was given alone", () => {
			const before = structuredClone(values);

			PathRebaser.values(values, "/repo", "/repo/places/lobby");

			expect(values).toEqual(before);
		});
	});
});
