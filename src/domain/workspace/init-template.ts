import { CONFIG_SUFFIX } from "../config/config-discovery.js";

export const TEMPLATE_FILE = "template.project.json";
export const PROJECT_SUFFIX = ".project.json";

export type TemplateChoice =
	/** Start `template.project.json` from the package mounts, when there are any. */
	| { readonly kind: "new" }
	/** Copy a hand-written project file to `template.project.json`. */
	| { readonly kind: "copy"; readonly from: string }
	/** Reference a hand-written project file as it is. */
	| { readonly kind: "use"; readonly file: string };

/** Project files in the directory that no config beside them writes, other than `template.project.json`. */
export function handWrittenProjectFiles(
	existingFiles: ReadonlySet<string>
): string[] {
	return [...existingFiles]
		.filter(
			(file) =>
				file.endsWith(PROJECT_SUFFIX) &&
				file !== TEMPLATE_FILE &&
				!existingFiles.has(
					`${file.slice(0, -PROJECT_SUFFIX.length)}${CONFIG_SUFFIX}`
				)
		)
		.sort();
}

/**
 * Copies the first hand-written file among `outputs`, the project files the
 * new configs would replace, so a build never loses it. Otherwise starts new.
 */
export function defaultTemplateChoice(
	existingFiles: ReadonlySet<string>,
	outputs: readonly string[]
): TemplateChoice {
	if (existingFiles.has(TEMPLATE_FILE)) return { kind: "new" };
	const handWritten = handWrittenProjectFiles(existingFiles);
	const replaced = outputs.find((output) => handWritten.includes(output));
	return replaced ? { kind: "copy", from: replaced } : { kind: "new" };
}
