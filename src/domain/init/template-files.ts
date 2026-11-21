import { starterTemplates } from "./starter-templates.js";

export function templateFiles(variant: string): Map<string, string> {
	const prefix = `${variant}/`;
	return new Map(
		Object.entries(starterTemplates)
			.filter(([file]) => file.startsWith(prefix))
			.map(([file, content]) => [file.slice(prefix.length), content])
	);
}
