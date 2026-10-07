import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { renderHelpModule } from "./help-module.js";

export const HELP_DIR = path.resolve("help");
export const DIAGNOSTICS_PAGE = path.resolve(
	"docs/content/docs/v2/diagnostics.mdx"
);
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	fs.writeFileSync(OUTPUT, currentHelpModule());
	console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}`);
}
