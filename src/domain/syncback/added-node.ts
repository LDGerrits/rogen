import { parse } from "../../base/jsonc.js";
import { isObject, setOwn } from "../../base/objects.js";
import { RojoFile } from "../rojo/rojo.js";
import { RojoNode } from "../rojo/rojo-project.js";
import { instanceNameOf } from "./reverse-router.js";

/** A file or an empty folder Rojo wrote for a new instance. */
export interface WrittenEntry {
	/** The names from the instance's own file or folder down. */
	readonly path: readonly string[];
	/** None for an empty folder. */
	readonly text?: string;
}

const MODEL_SUFFIX = ".model.json";
const TEXT_SUFFIX = ".txt";

const MODEL_KEYS: ReadonlySet<string> = new Set([
	"name",
	"className",
	"properties",
	"attributes",
	"children",
]);
const META_KEYS: ReadonlySet<string> = new Set(["properties", "attributes"]);
const INIT_META_KEYS: ReadonlySet<string> = new Set([
	"className",
	...META_KEYS,
]);

/** The prefix of the attributes Rojo keeps a reference between instances in, which a node can't hold. */
const REFERENCE = "Rojo_";

const objectOf = (
	text: string | undefined
): Record<string, unknown> | undefined => {
	if (text === undefined) return undefined;
	const parsed = parse(text);
	return parsed.isOk() && isObject(parsed.value) ? parsed.value : undefined;
};

const isChildName = (name: string) => !name.startsWith("$");

/** The `$properties` and `$attributes` of a model or meta file; none when it has a key outside `keys` or a reference. */
function fieldsOf(
	file: Record<string, unknown>,
	keys: ReadonlySet<string>
): RojoNode | undefined {
	if (Object.keys(file).some((key) => !keys.has(key))) return undefined;
	const { properties, attributes } = file;
	if (properties !== undefined && !isObject(properties)) return undefined;
	if (
		attributes !== undefined &&
		(!isObject(attributes) ||
			Object.keys(attributes).some((key) => key.startsWith(REFERENCE)))
	)
		return undefined;
	return {
		...(properties !== undefined &&
			Object.keys(properties).length > 0 && { $properties: properties }),
		...(attributes !== undefined &&
			Object.keys(attributes).length > 0 && { $attributes: attributes }),
	};
}

function modelNode(model: unknown): RojoNode | undefined {
	if (!isObject(model) || typeof model.className !== "string")
		return undefined;
	const fields = fieldsOf(model, MODEL_KEYS);
	const { children = [] } = model;
	if (!fields || !Array.isArray(children)) return undefined;
	const node: RojoNode = { $className: model.className, ...fields };
	for (const child of children) {
		if (
			!isObject(child) ||
			typeof child.name !== "string" ||
			!isChildName(child.name) ||
			Object.hasOwn(node, child.name)
		)
			return undefined;
		const made = modelNode(child);
		if (!made) return undefined;
		setOwn(node, child.name, made);
	}
	return node;
}

function fileNode(entries: readonly WrittenEntry[]): RojoNode | undefined {
	const named = (suffix: string) =>
		entries.find(({ path }) => path[0].endsWith(suffix));
	const model = named(MODEL_SUFFIX);
	if (model && entries.length === 1) return modelNode(objectOf(model.text));
	const text = named(TEXT_SUFFIX);
	const meta = named(RojoFile.META_SUFFIX);
	if (text?.text === undefined || entries.length !== (meta ? 2 : 1))
		return undefined;
	const metaFile = meta ? objectOf(meta.text) : {};
	const fields = metaFile && fieldsOf(metaFile, META_KEYS);
	if (!fields) return undefined;
	return {
		$className: "StringValue",
		$properties: { Value: text.text, ...fields.$properties },
		...(fields.$attributes && { $attributes: fields.$attributes }),
	};
}

function folderNode(entries: readonly WrittenEntry[]): RojoNode | undefined {
	const children = new Map<string, WrittenEntry[]>();
	let meta: string | undefined;
	for (const { path, text } of entries) {
		if (path.length === 1) {
			if (text !== undefined) return undefined;
			continue;
		}
		const inside = path.slice(1);
		const isFile = inside.length === 1 && text !== undefined;
		if (isFile && inside[0].startsWith(`${RojoFile.INIT_NAME}.`)) {
			if (inside[0] !== RojoFile.INIT_META) return undefined;
			meta = text;
			continue;
		}
		const name = isFile ? instanceNameOf(inside[0]) : inside[0];
		children.set(name, [
			...(children.get(name) ?? []),
			{ path: inside, text },
		]);
	}
	const metaFile = meta === undefined ? {} : objectOf(meta);
	const fields = metaFile && fieldsOf(metaFile, INIT_META_KEYS);
	const className = metaFile?.className ?? "Folder";
	if (!fields || typeof className !== "string") return undefined;
	const node: RojoNode = { $className: className, ...fields };
	for (const [name, held] of children) {
		const child = isChildName(name) ? addedNode(held) : undefined;
		if (!child) return undefined;
		setOwn(node, name, child);
	}
	return node;
}

/** The node of the config's tree that makes the instance Rojo wrote `entries` for, in Rojo's node form; none when the tree can't describe it, as for a script or a binary model. */
export function addedNode(
	entries: readonly WrittenEntry[]
): RojoNode | undefined {
	return entries.some(
		({ path, text }) => path.length > 1 || text === undefined
	)
		? folderNode(entries)
		: fileNode(entries);
}
