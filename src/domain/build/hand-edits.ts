import { isDeepStrictEqual } from "util";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { WrittenRecords } from "./written-records.js";

/** What a hand edit of a project file holds that a build would not write: a key of the file, or a node of its tree or one key of a node, by the instance path it lies at. */
export type HandEdit =
	| { readonly kind: "file"; readonly key: string; readonly value: unknown }
	| {
			readonly kind: "node";
			readonly instancePath: readonly string[];
			/** The key of the node that was lost, such as `$className`; none when the whole node is. */
			readonly key?: string;
			readonly value: unknown;
	  };

/** Keys of the file that say nothing a build would miss: `fmt-project` adds a name, and a build may leave it out. */
const LEFT_OUT = new Set(["name", "$schema"]);

function nodeEdits(
	onDisk: Record<string, unknown>,
	written: Record<string, unknown>,
	instancePath: readonly string[]
): HandEdit[] {
	return Object.entries(onDisk).flatMap(([key, value]): HandEdit[] => {
		const there = written[key];
		if (!key.startsWith("$") && isObject(value))
			return isObject(there)
				? nodeEdits(value, there, [...instancePath, key])
				: [
						{
							kind: "node",
							instancePath: [...instancePath, key],
							value,
						},
					];
		return isDeepStrictEqual(value, there)
			? []
			: [{ kind: "node", instancePath, key, value }];
	});
}

/** Why Rogen takes a project file as edited by hand: what the edit holds that a build would drop, or that the file no longer reads as a project file. */
export type Edited = readonly HandEdit[] | "unreadable";

/** How a project file on disk differs from the text a build would write, in what a build would drop. */
export const HandEdits = {
	/** What `onDisk` holds that `content` does not, or `undefined` when either does not read as a project file. Nothing is left when the two read the same, as after `rojo fmt-project`. */
	lost(onDisk: string, content: string): HandEdit[] | undefined {
		const found = parse(onDisk);
		const written = parse(content);
		if (
			found.isErr() ||
			written.isErr() ||
			!isObject(found.value) ||
			!isObject(written.value)
		)
			return undefined;
		const wanted = written.value;
		return Object.entries(found.value).flatMap(([key, value]) => {
			if (LEFT_OUT.has(key)) return [];
			if (key === "tree" && isObject(value) && isObject(wanted.tree))
				return nodeEdits(value, wanted.tree, []);
			return isDeepStrictEqual(value, wanted[key])
				? []
				: [{ kind: "file" as const, key, value }];
		});
	},

	/** Whether `onDisk` was edited by hand in a way that writing `content` over it would lose. A file that Rogen never wrote, or that is as it last wrote it, is not; nor is one that reads the same as `content`, as after `rojo fmt-project`. */
	async editedBy(
		records: WrittenRecords,
		file: string,
		onDisk: string,
		content: string
	): Promise<Edited | undefined> {
		if (onDisk === content) return undefined;
		const last = await records.lastWritten(file);
		if (last === undefined || last === WrittenRecords.hashOf(onDisk))
			return undefined;
		const lost = HandEdits.lost(onDisk, content);
		if (lost === undefined) return "unreadable";
		return lost.length > 0 ? lost : undefined;
	},

	/** The edits as they read in a message: `ServerStorage/Assets`, `Workspace: $className`, or the key of the file. */
	describe(edit: HandEdit): string {
		if (edit.kind === "file") return `"${edit.key}"`;
		const node = edit.instancePath.join("/") || "the root of the tree";
		return edit.key === undefined ? node : `${node} (${edit.key})`;
	},

	/** The nodes of the edits as the `tree` entries that hold them, which go into the `tree` of `default.rogen.json`. */
	asTree(edits: readonly HandEdit[]): Record<string, unknown> {
		const tree = Object.create(null) as Record<string, unknown>;
		for (const edit of edits) {
			if (edit.kind === "file") continue;
			const { instancePath, key, value } = edit;
			const holder =
				key === undefined ? instancePath.slice(0, -1) : instancePath;
			let node = tree;
			for (const name of holder) {
				const next = node[name];
				node = isObject(next)
					? next
					: (node[name] = Object.create(null) as Record<
							string,
							unknown
						>);
			}
			if (key === undefined) node[instancePath.at(-1)!] = value;
			else node[key] = value;
		}
		return tree;
	},

	/** The keys of the file among the edits, which go into `default.rogen.json` beside its `tree`. */
	asKeys(edits: readonly HandEdit[]): Record<string, unknown> {
		return Object.fromEntries(
			edits.flatMap((edit) =>
				edit.kind === "file" ? [[edit.key, edit.value]] : []
			)
		);
	},
};
