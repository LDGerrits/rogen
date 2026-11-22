import path from "path";
import { compiledPathOf } from "../resolved-config.js";

describe("compiledPathOf", () => {
	const projectDir = path.resolve("/repo");
	const compiledPath = path.join(projectDir, "out");

	it("should keep a file where it is when the config compiles nothing", () => {
		const file = path.join(projectDir, "src", "A.luau");

		expect(
			compiledPathOf(
				{ projectDir, compiledPath: undefined, commonRoot: undefined },
				file
			)
		).toBe(file);
	});

	it("should place a file under the compiled path as it lies under the project folder when there are no source paths", () => {
		expect(
			compiledPathOf(
				{ projectDir, compiledPath, commonRoot: undefined },
				path.join(projectDir, "lib", "A.luau")
			)
		).toBe(path.join(compiledPath, "lib", "A.luau"));
	});
});
