import fs from "fs";
import path from "path";

const sourceFiles = (dir: string): string[] =>
	fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory())
			return entry.name === "__tests__" ? [] : sourceFiles(full);
		return entry.name.endsWith(".ts") ? [full] : [];
	});

describe("the exit code of a command", () => {
	it.each(sourceFiles("src/commands").map((file) => [file] as const))(
		"should not be set by %s, since a command returns its outcome and exitCode() chooses the number",
		(file) => {
			const text = fs.readFileSync(file, "utf8");

			expect(text).not.toMatch(/process\.exit\b/);
			expect(text).not.toMatch(/\bexitCode\s*=[^=]/);
		}
	);
});
