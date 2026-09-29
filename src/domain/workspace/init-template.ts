import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/object.js";
import { CONFIG_SUFFIX } from "../config/config-discovery.js";
import { RojoNode, RojoPath, isRojoPath } from "../rojo/rojo-tree.js";
import { TemplateMount, templateTree } from "./init-mounts.js";
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

export interface TemplateProject {
	readonly tree: RojoNode;
	readonly [key: string]: unknown;
}

const pathOf = (rojoPath: RojoPath): string =>
	normalizeRootDir(
		typeof rojoPath === "string" ? rojoPath : rojoPath.optional
	);

/** `undefined` when `content` isn't a project object with a tree. */
export function parseTemplateProject(
	content: string
): TemplateProject | undefined {
	const parsed = parse(content);
	if (parsed.isErr() || !isObject(parsed.value)) return undefined;
	const { tree } = parsed.value;
	return isObject(tree) ? { ...parsed.value, tree } : undefined;
}

/**
 * `project` without the nodes whose `$path` points into `dirs`, which Rogen
 * generates now. `undefined` when a dir is the whole folder, so it can't tell.
 */
export function stripGeneratedNodes(
	project: TemplateProject,
	dirs: readonly string[]
): { project: TemplateProject; removed: string[] } | undefined {
	const claimed = dirs.map(normalizeRootDir);
	if (claimed.includes(".")) return undefined;

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

	return { project: { ...project, tree: strip(project.tree, []) }, removed };
}

interface FoundMount {
	readonly path: string;
	readonly node: string;
}

/** Every `$path` in `node` and below. */
function mountsIn(node: RojoNode, at: readonly string[]): FoundMount[] {
	return [
		...(isRojoPath(node.$path)
			? [{ path: pathOf(node.$path), node: at.join("/") }]
			: []),
		...Object.entries(node).flatMap(([key, value]) =>
			!key.startsWith("$") && isObject(value)
				? mountsIn(value, [...at, key])
				: []
		),
	];
}

/**
 * `project` with the `mounts` it doesn't mount anywhere yet, each as
 * `<path> at <node>`. A node already at a mount's place wins over the mount.
 */
export function addMissingMounts(
	project: TemplateProject,
	mounts: readonly TemplateMount[]
): { project: TemplateProject; added: string[] } {
	const mounted = new Set(mountsIn(project.tree, []).map(({ path }) => path));
	const missing = mounts.filter(
		(mount) => !mounted.has(normalizeRootDir(mount.path))
	);
	const added: FoundMount[] = [];
	const merge = (
		node: RojoNode,
		additions: RojoNode,
		at: readonly string[]
	): RojoNode => {
		const merged: RojoNode = { ...node };
		for (const [key, value] of Object.entries(additions)) {
			if (key.startsWith("$") || !isObject(value)) continue;
			const existing = merged[key];
			if (isRojoPath(value.$path)) {
				if (existing === undefined) {
					merged[key] = value;
					added.push(...mountsIn(value, [...at, key]));
				}
			} else if (existing === undefined || isObject(existing)) {
				const before = added.length;
				const container = merge(
					isObject(existing)
						? existing
						: value.$className
							? { $className: value.$className }
							: {},
					value,
					[...at, key]
				);
				if (added.length > before) merged[key] = container;
			}
		}
		return merged;
	};

	const tree = merge(project.tree, templateTree(missing), []);
	return {
		project: { ...project, tree },
		added: added.map(({ path, node }) => `${path} at ${node}`),
	};
}
