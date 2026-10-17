import { compareStrings } from "../../base/collections.js";
import { isObject } from "../../base/objects.js";
import { FloatText, PropertyValues } from "./property-values.js";
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

/** The keys of a sync rule, in the order Rojo writes them. */
const SYNC_RULE_KEYS = ["pattern", "exclude", "use", "suffix"];

/** The keys of `syncbackRules`, in the order Rojo writes them. */
const SYNCBACK_RULE_KEYS = [
	"ignoreTrees",
	"ignorePaths",
	"ignoreProperties",
	"syncCurrentCamera",
	"syncUnscriptable",
	"ignoreReferents",
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

/** The key of a config that holds project files of its own. */
const PROJECTS_KEY = "projects";

/** A project file as text, formatted as `rojo fmt-project` would. */
export class ProjectText {
	static of(file: RojoProjectFile): string {
		return ProjectText.print(ProjectText.file({ ...file }, []), "");
	}

	/** A config as text: Rojo's keys in Rojo's order, then `rogenKeys` in the order given, then any other; each entry of `projects` the same way. */
	static ofConfig(
		config: Record<string, unknown>,
		rogenKeys: readonly string[]
	): string {
		return ProjectText.print(ProjectText.file(config, rogenKeys), "");
	}

	private static file(
		all: Record<string, unknown>,
		rogenKeys: readonly string[]
	): Ordered {
		const entries: [string, unknown][] = [];
		const ordered = [...FILE_KEYS, ...rogenKeys];
		for (const key of ordered)
			if (key in all)
				entries.push([
					key,
					ProjectText.fileValue(key, all[key], rogenKeys),
				]);
		for (const key of Object.keys(all))
			if (!ordered.includes(key)) entries.push([key, all[key]]);
		return new Ordered(entries);
	}

	private static fileValue(
		key: string,
		value: unknown,
		rogenKeys: readonly string[]
	): unknown {
		if (key === "tree" && isObject(value)) return ProjectText.node(value);
		if (key === "syncRules" && Array.isArray(value))
			return value.map((rule) =>
				isObject(rule)
					? ProjectText.inOrder(rule, SYNC_RULE_KEYS)
					: rule
			);
		if (key === "syncbackRules" && isObject(value))
			return ProjectText.syncbackRules(value);
		if (
			key !== PROJECTS_KEY ||
			!rogenKeys.includes(key) ||
			!isObject(value)
		)
			return value;
		const inner = rogenKeys.filter((rogen) => rogen !== PROJECTS_KEY);
		return new Ordered(
			Object.entries(value).map(([name, project]) => [
				name,
				isObject(project) ? ProjectText.file(project, inner) : project,
			])
		);
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

	private static syncbackRules(rules: Record<string, unknown>): Ordered {
		const { ignoreProperties } = rules;
		return ProjectText.inOrder(
			isObject(ignoreProperties)
				? {
						...rules,
						ignoreProperties:
							ProjectText.sortedKeys(ignoreProperties),
					}
				: rules,
			SYNCBACK_RULE_KEYS
		);
	}

	/** `value` with `keys` first, in that order, then any others as they were. */
	private static inOrder(
		value: Record<string, unknown>,
		keys: readonly string[]
	): Ordered {
		return new Ordered([
			...keys
				.filter((key) => key in value)
				.map((key) => [key, value[key]] as const),
			...Object.entries(value).filter(([key]) => !keys.includes(key)),
		]);
	}

	private static sortedKeys(value: Record<string, unknown>): Ordered {
		return new Ordered(
			Object.keys(value)
				.sort(compareStrings)
				.map((key) => [key, value[key]])
		);
	}

	private static sorted(value: unknown): unknown {
		if (!isObject(value)) return value;
		const typed = PropertyValues.typed(value);
		return new Ordered(
			Object.keys(typed)
				.sort(compareStrings)
				.map((key) => [key, typed[key]])
		);
	}

	/** `serde_json`'s pretty form: two spaces, one entry per line, and `{}` and `[]` for nothing. */
	private static print(value: unknown, indent: string): string {
		const inner = indent + INDENT;
		if (value instanceof FloatText) return value.toString();
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
