import { isObject } from "../../base/objects.js";
import { parse, setJsoncValue } from "../../base/jsonc.js";
import { RojoNode, childNodes } from "../rojo/rojo-project.js";

export interface TreeChange {
	readonly node: readonly string[];
	readonly set: Readonly<Record<string, unknown>>;
	readonly remove: readonly string[];
	readonly added: readonly {
		readonly name: string;
		readonly node: RojoNode;
	}[];
}

const isKey = (key: string) => key.startsWith("$") && key !== "$path";

const same = (a: unknown, b: unknown): boolean => {
	if (isObject(a) && isObject(b)) {
		const keys = Object.keys(a);
		return (
			keys.length === Object.keys(b).length &&
			keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
		);
	}
	if (Array.isArray(a) && Array.isArray(b))
		return (
			a.length === b.length && a.every((item, at) => same(item, b[at]))
		);
	return a === b;
};

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
		if (!same(before[key], after[key])) set[key] = after[key];
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
	if (parsed.isErr())
		return { text, unhomed: changes.map(({ node }) => node) };
	let edited = text;
	const unhomed: (readonly string[])[] = [];
	for (const { node, set, remove, added } of changes) {
		const found = nodeAt(parsed.value, [...treeAt, ...node]);
		if (!found) {
			unhomed.push(node);
			continue;
		}
		const at = [...treeAt, ...node];
		for (const [key, value] of Object.entries(set))
			edited = setJsoncValue(edited, [...at, key], value);
		for (const key of remove)
			if (key in found)
				edited = setJsoncValue(edited, [...at, key], undefined);
		for (const { name, node: child } of added) {
			if (holdsPath(child)) unhomed.push([...node, name]);
			else edited = setJsoncValue(edited, [...at, name], child);
		}
	}
	return { text: edited, unhomed };
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
