import { isObject } from "../../base/objects.js";
import { parse, setJsoncValue } from "../../base/jsonc.js";
import { RojoNode } from "../rojo/rojo-project.js";

/** What Rojo's syncback changed at one node of the project file it ran on. */
export interface TreeChange {
	/** The names from the root to the node; none for the root. */
	readonly node: readonly string[];
	/** The `$` keys it set to a new value. */
	readonly set: Readonly<Record<string, unknown>>;
	/** The `$` keys it took off. */
	readonly remove: readonly string[];
	/** The child nodes it added. */
	readonly added: readonly {
		readonly name: string;
		readonly node: RojoNode;
	}[];
}

const isKey = (key: string) => key.startsWith("$") && key !== "$path";

const children = (node: RojoNode): [string, RojoNode][] =>
	Object.entries(node).filter(
		(entry): entry is [string, RojoNode] =>
			!entry[0].startsWith("$") && isObject(entry[1])
	);

const same = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

/** The changes that turn `before` into `after`, node by node. A node Rojo left out is not a change, as it can't remove one a project file defines; `$path` is not one either, as it points into the mirror. */
export function treeChanges(
	before: RojoNode,
	after: RojoNode,
	node: readonly string[] = []
): TreeChange[] {
	const set: Record<string, unknown> = {};
	const remove: string[] = [];
	for (const key of Object.keys(after).filter(isKey))
		if (!same(before[key], after[key])) set[key] = after[key];
	for (const key of Object.keys(before).filter(isKey))
		if (!(key in after)) remove.push(key);
	const known = new Map(children(before));
	const added = children(after)
		.filter(([name]) => !known.has(name))
		.map(([name, child]) => ({ name, node: child }));
	const here: TreeChange[] =
		Object.keys(set).length + remove.length + added.length > 0
			? [{ node, set, remove, added }]
			: [];
	return [
		...here,
		...children(after).flatMap(([name, child]) => {
			const old = known.get(name);
			return old ? treeChanges(old, child, [...node, name]) : [];
		}),
	];
}

/** The text of a config with the changes made to the tree at `treeAt`, and the nodes it has no place for. */
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
		for (const { name, node: child } of added)
			edited = setJsoncValue(edited, [...at, name], child);
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
