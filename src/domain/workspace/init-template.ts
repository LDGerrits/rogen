import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/object.js";
import { CONFIG_SUFFIX } from "../config/config-discovery.js";
import { RojoNode, RojoPath, isRojoPath } from "../rojo/rojo-tree.js";
import { normalizeRootDir } from "./init-root-dirs.js";

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

const pathOf = (rojoPath: RojoPath): string =>
	normalizeRootDir(
		typeof rojoPath === "string" ? rojoPath : rojoPath.optional
	);

/**
 * `content` without the nodes whose `$path` points into `dirs`, which Rogen
 * generates now. `undefined` when it can't tell: `content` isn't a project, or
 * a dir is the whole folder.
 */
export function stripGeneratedNodes(
	content: string,
	dirs: readonly string[]
): { project: Record<string, unknown>; removed: string[] } | undefined {
	const claimed = dirs.map(normalizeRootDir);
	if (claimed.includes(".")) return undefined;
	const parsed = parse(content);
	if (parsed.isErr() || !isObject(parsed.value)) return undefined;
	const { tree } = parsed.value;
	if (!isObject(tree)) return undefined;

	const isClaimed = (value: unknown) => {
		if (!isRojoPath(value)) return false;
		const target = pathOf(value);
		return claimed.some(
			(dir) => target === dir || target.startsWith(`${dir}/`)
		);
	};

	const removed: string[] = [];
	const strip = (node: RojoNode, at: readonly string[]): RojoNode => {
		const kept: RojoNode = {};
		for (const [key, value] of Object.entries(node)) {
			if (key.startsWith("$") || !isObject(value)) {
				kept[key] = value;
			} else if (isClaimed(value.$path)) {
				removed.push([...at, key].join("/"));
			} else {
				kept[key] = strip(value, [...at, key]);
			}
		}
		return kept;
	};

	return { project: { ...parsed.value, tree: strip(tree, []) }, removed };
}
