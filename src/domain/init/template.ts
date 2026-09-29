import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/object.js";
import { normalizeDir } from "../../base/path.js";
import { configFileName } from "../config/config-discovery.js";
import {
	ContainerFactory,
	PROJECT_SUFFIX,
	RojoProject,
} from "../rojo/rojo-project.js";
import {
	RojoNode,
	childNodes,
	instanceKey,
	rojoPathTarget,
} from "../rojo/rojo-tree.js";
import { Mount } from "../toolchain/toolchain.js";

export const TEMPLATE_FILE = "template.project.json";

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
					configFileName(file.slice(0, -PROJECT_SUFFIX.length))
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

/** Services stay bare, since Rojo knows their class; deeper containers are folders. */
const templateContainer: ContainerFactory = (instancePath) =>
	instancePath.length === 1 ? {} : { $className: "Folder" };

const landingOf = (mount: Mount): string[] => mount.landing.split("/");

const mountNode = ({ path, optional }: Mount): Partial<RojoNode> => ({
	$path: optional ? { optional: path } : path,
});

/** The DataModel children that mount `mounts`, each at its landing. */
export function templateTree(mounts: readonly Mount[]): RojoNode {
	const project = new RojoProject({ tree: {} }, templateContainer);
	for (const mount of mounts)
		project.insertNode(landingOf(mount), mountNode(mount));
	return project.getTree().tree;
}

/** `undefined` when `content` isn't a project object with a tree. */
export function parseTemplateProject(
	content: string
): TemplateProject | undefined {
	const parsed = parse(content);
	if (parsed.isErr() || !isObject(parsed.value)) return undefined;
	const { tree } = parsed.value;
	return isObject(tree) ? { ...parsed.value, tree } : undefined;
}

const isUnder = (target: string, dir: string) =>
	target === dir || target.startsWith(`${dir}/`);

/**
 * `project` without the nodes whose `$path` points into `dirs`, which Rogen
 * generates now. `undefined` when a dir is the whole folder, so it can't tell.
 */
export function stripGeneratedNodes(
	project: TemplateProject,
	dirs: readonly string[]
): { project: TemplateProject; removed: string[] } | undefined {
	const claimed = dirs.map(normalizeDir);
	if (claimed.includes(".")) return undefined;

	const edited = new RojoProject(project, templateContainer);
	const removed = edited.removeNodes((target) =>
		claimed.some((dir) => isUnder(normalizeDir(target), dir))
	);
	return {
		project: edited.getTree(),
		removed: removed.map((instancePath) => instanceKey(instancePath)),
	};
}

/**
 * `project` with the `mounts` it doesn't mount yet, itself or through a parent
 * folder, each as `<path> at <node>`, in tree order. A node already where a
 * mount would go wins, and every mount at or below it is listed in `skipped`.
 */
export function addMissingMounts(
	project: TemplateProject,
	mounts: readonly Mount[]
): { project: TemplateProject; added: string[]; skipped: string[] } {
	const edited = new RojoProject(project, templateContainer);
	const mounted = edited
		.getPaths()
		.map(({ path }) => normalizeDir(rojoPathTarget(path)));
	const missing = mounts.filter(
		(mount) =>
			!mounted.some((dir) => isUnder(normalizeDir(mount.path), dir))
	);

	const added: string[] = [];
	const skipped: string[] = [];
	const describe = (node: RojoNode, at: readonly string[]) =>
		new RojoProject({ tree: node }, templateContainer)
			.getPaths()
			.map(
				({ path, instancePath }) =>
					`${normalizeDir(rojoPathTarget(path))} at ${instanceKey([...at, ...instancePath])}`
			);
	const merge = (
		node: RojoNode,
		additions: RojoNode,
		at: readonly string[]
	): RojoNode => {
		const merged: RojoNode = { ...node };
		for (const [key, value] of childNodes(additions)) {
			const existing = merged[key];
			const path = [...at, key];
			if (value.$path !== undefined) {
				if (existing === undefined) {
					merged[key] = value;
					added.push(...describe(value, path));
				} else {
					skipped.push(...describe(value, path));
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
					path
				);
				if (added.length > before) merged[key] = container;
			}
		}
		return merged;
	};

	return {
		project: {
			...project,
			tree: merge(project.tree, templateTree(missing), []),
		},
		added,
		skipped,
	};
}
