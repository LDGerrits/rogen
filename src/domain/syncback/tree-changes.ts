import { isObject, isSameJson, setOwn } from "../../base/objects.js";
import { JsoncComments } from "../../base/jsonc-comments.js";
import { parse } from "../../base/jsonc.js";
import { ROGEN_KEYS } from "../config/config.js";
import { ProjectText, WrittenTree } from "../rojo/project-text.js";
import { NODE_FIELDS, RojoNode, childNodes } from "../rojo/rojo-project.js";

export interface TreeChange {
	readonly node: readonly string[];
	readonly set: Readonly<Record<string, unknown>>;
	readonly remove: readonly string[];
	readonly added: readonly {
		readonly name: string;
		readonly node: RojoNode;
	}[];
}

const isKey = (key: string) => NODE_FIELDS.has(key) && key !== "$path";

const CLEARABLE = ["$properties", "$attributes"];

const holdsPath = (node: RojoNode): boolean =>
	node.$path !== undefined ||
	childNodes(node).some(([, child]) => holdsPath(child));

export function treeChanges(
	before: RojoNode,
	after: RojoNode,
	node: readonly string[] = []
): TreeChange[] {
	const set: Record<string, unknown> = {};
	const remove: string[] = [];
	for (const key of Object.keys(after).filter(isKey))
		if (!isSameJson(before[key], after[key])) set[key] = after[key];
	for (const key of CLEARABLE)
		if (key in before && !(key in after)) remove.push(key);
	const known = new Map(childNodes(before));
	const added = childNodes(after)
		.filter(([name]) => !known.has(name))
		.map(([name, child]) => ({ name, node: child }));
	const here: TreeChange[] =
		Object.keys(set).length + remove.length + added.length > 0
			? [{ node, set, remove, added }]
			: [];
	return [
		...here,
		...childNodes(after).flatMap(([name, child]) => {
			const old = known.get(name);
			return old ? treeChanges(old, child, [...node, name]) : [];
		}),
	];
}

export function applyTreeChanges(
	text: string,
	treeAt: readonly string[],
	changes: readonly TreeChange[]
): { readonly text: string; readonly unhomed: (readonly string[])[] } {
	if (changes.length === 0) return { text, unhomed: [] };
	const parsed = parse(text);
	if (parsed.isErr() || !isObject(parsed.value))
		return { text, unhomed: changes.map(({ node }) => node) };
	const config = structuredClone(parsed.value);
	const unhomed: (readonly string[])[] = [];
	let applied = false;
	for (const { node, set, remove, added } of changes) {
		const found = nodeAt(config, [...treeAt, ...node]);
		if (!found) {
			unhomed.push(node);
			continue;
		}
		for (const [key, value] of Object.entries(set)) {
			setOwn(found, key, value);
			applied = true;
		}
		for (const key of remove)
			if (key in found) {
				delete found[key];
				applied = true;
			}
		for (const { name, node: child } of added) {
			if (holdsPath(child)) unhomed.push([...node, name]);
			else {
				setOwn(found, name, child);
				applied = true;
			}
		}
	}
	if (!applied) return { text, unhomed };
	return {
		text: ProjectText.ofConfig(
			config,
			ROGEN_KEYS,
			WrittenTree.of(text),
			JsoncComments.of(text)
		),
		unhomed,
	};
}

function nodeAt(
	root: unknown,
	at: readonly string[]
): Record<string, unknown> | undefined {
	let found: unknown = root;
	for (const name of at) {
		if (!isObject(found) || !Object.hasOwn(found, name)) return undefined;
		found = found[name];
	}
	return isObject(found) ? found : undefined;
}
