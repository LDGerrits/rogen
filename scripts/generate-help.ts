import fs from "fs";
import path from "path";
import { renderHelpModule } from "./help-module.js";

const HELP_DIR = path.resolve("help");
const DIAGNOSTICS_PAGE = path.resolve("docs/content/docs/v2/diagnostics.mdx");
export const OUTPUT = path.resolve("src/commands/help/help-texts.ts");

export function currentHelpModule(): string {
	const topics = Object.fromEntries(
		fs
			.readdirSync(HELP_DIR)
			.filter((file) => file.endsWith(".md"))
			.map((file) => [
				path.basename(file, ".md"),
				fs.readFileSync(path.join(HELP_DIR, file), "utf8"),
			])
	);
	return renderHelpModule(topics, fs.readFileSync(DIAGNOSTICS_PAGE, "utf8"));
}
