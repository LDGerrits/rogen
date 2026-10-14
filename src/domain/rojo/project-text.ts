import { compareStrings } from "../../base/collections.js";
import { isObject } from "../../base/objects.js";
import { RojoProjectFile } from "./rojo-project.js";

/** The keys of a project file in the order Rojo writes them. */
const FILE_KEYS = [
	"$schema",
	"name",
	"tree",
	"servePort",
	"servePlaceIds",
	"blockedPlaceIds",
	"placeId",
	"gameId",
	"serveAddress",
	"serveAllowedHosts",
	"emitLegacyScripts",
	"globIgnorePaths",
	"syncbackRules",
	"syncRules",
];

/** The node keys around the children, in the order Rojo writes them. */
const NODE_KEYS_BEFORE = ["$className", "$id"];
const NODE_KEYS_AFTER = [
	"$properties",
	"$attributes",
	"$ignoreUnknownInstances",
	"$path",
];

type Entries = readonly (readonly [string, unknown])[];

class Ordered {
	constructor(readonly entries: Entries) {}
}

const INDENT = "  ";

/** A project file as text, formatted as `rojo fmt-project` would. */
export class ProjectText {
	static of(file: RojoProjectFile, schema: string): string {
		const { $schema: _written, ...fields } = file as RojoProjectFile & {
			$schema?: string;
		};
		const all: Record<string, unknown> = { $schema: schema, ...fields };
		const entries: [string, unknown][] = [];
		for (const key of FILE_KEYS)
			if (key in all)
				entries.push([
					key,
					key === "tree" && isObject(all.tree)
						? ProjectText.node(all.tree)
						: all[key],
				]);
		for (const key of Object.keys(all))
			if (!FILE_KEYS.includes(key)) entries.push([key, all[key]]);
		return ProjectText.print(new Ordered(entries), "");
	}

	private static node(node: Record<string, unknown>): Ordered {
		const entries: [string, unknown][] = [];
		for (const key of NODE_KEYS_BEFORE)
			if (key in node) entries.push([key, node[key]]);
		const children = Object.keys(node)
			.filter((key) => !key.startsWith("$"))
			.sort(compareStrings);
		for (const child of children) {
			const value = node[child];
			entries.push([
				child,
				isObject(value) ? ProjectText.node(value) : value,
			]);
		}
		for (const key of NODE_KEYS_AFTER)
			if (key in node)
				entries.push([
					key,
					key === "$properties" || key === "$attributes"
						? ProjectText.sorted(node[key])
						: node[key],
				]);
		for (const key of Object.keys(node))
			if (
				key.startsWith("$") &&
				![...NODE_KEYS_BEFORE, ...NODE_KEYS_AFTER].includes(key)
			)
				entries.push([key, node[key]]);
		return new Ordered(entries);
	}

	private static sorted(value: unknown): unknown {
		return isObject(value)
			? new Ordered(
					Object.keys(value)
						.sort(compareStrings)
						.map((key) => [key, value[key]])
				)
			: value;
	}

	/** `serde_json`'s pretty form: two spaces, one entry per line, and `{}` and `[]` for nothing. */
	private static print(value: unknown, indent: string): string {
		const inner = indent + INDENT;
		if (value instanceof Ordered)
			return value.entries.length === 0
				? "{}"
				: `{\n${value.entries
						.map(
							([key, entry]) =>
								`${inner}${JSON.stringify(key)}: ${ProjectText.print(entry, inner)}`
						)
						.join(",\n")}\n${indent}}`;
		if (Array.isArray(value))
			return value.length === 0
				? "[]"
				: `[\n${value
						.map(
							(entry) =>
								`${inner}${ProjectText.print(entry, inner)}`
						)
						.join(",\n")}\n${indent}]`;
		if (isObject(value))
			return ProjectText.print(
				new Ordered(Object.entries(value)),
				indent
			);
		return JSON.stringify(value);
	}
}
