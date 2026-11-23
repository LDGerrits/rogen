import fs from "fs";
import path from "path";

const PAGE = path.resolve(
	import.meta.dirname,
	"../../docs/content/docs/v2/diagnostics.mdx"
);

export function exampleMessage(code: string, containing = ""): string {
	const ending = ` (${code})`;
	const found = fs
		.readFileSync(PAGE, "utf8")
		.split("\n")
		.filter((line) => line.endsWith(ending) && line.includes(containing))
		.map((line) => line.replace(/^(?:error|warning): /, ""))
		.map((line) => line.slice(0, -ending.length));
	if (found.length !== 1)
		throw new Error(
			`The diagnostics page has ${found.length} examples of ${code} containing "${containing}".`
		);
	return found[0];
}
