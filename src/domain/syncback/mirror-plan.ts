import { compareStrings } from "../../base/collections.js";
import { ancestors } from "../../base/path.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { instanceKey } from "../roblox/roblox.js";
import {
	CompiledChange,
	SyncbackChange,
	SyncbackPlan,
	UnplacedInstance,
} from "./syncback.js";

/** What applying a plan does to one path of the project, for one instance; paths are absolute, in the system's own form. */
export type Operation = {
	readonly file: string;
	readonly instance: string;
	/** The path of the mirror it comes from, when it comes from one. */
	readonly from?: string;
} & (
	| { readonly kind: "write"; readonly bytes: Uint8Array }
	| { readonly kind: "folder" }
	| { readonly kind: "remove" }
	/** A folder removed only once nothing is left in it, so what syncback leaves alone stays. */
	| { readonly kind: "prune" }
);

/** A new file syncback placed, and the instance the place had it as, for the check after the run. */
export interface Expected {
	readonly file: string;
	readonly instance: readonly string[];
}

/** The plan of a run on the mirror: what it writes, with the bytes, and the bytes each path it touches had, so a confirmed plan is written as it was shown. */
export class MirrorPlan implements SyncbackPlan {
	readonly changes: readonly SyncbackChange[];
	readonly compiled: readonly CompiledChange[];

	constructor(
		readonly project: ResolvedConfig,
		readonly unplaced: readonly UnplacedInstance[],
		/** Each change to compiled code, as many times as it was found. */
		compiled: readonly CompiledChange[],
		readonly operations: readonly Operation[],
		/** The bytes of the config, the place and each path the operations touch when the plan was made; `undefined` for a path that wasn't there. */
		private readonly before: ReadonlyMap<string, Uint8Array | undefined>,
		readonly expected: readonly Expected[],
		/** What `--list` prints for the run: see `SyncbackPlan.listed`. */
		readonly listed: readonly SyncbackChange[]
	) {
		this.compiled = outermost(compiled);
		this.changes = withoutRemovedInside(
			operations.map(({ kind, file }) => ({
				kind:
					kind === "remove" || kind === "prune" ? "remove" : "write",
				file,
			}))
		);
	}

	/** Whether every path the plan read still holds the bytes it had. */
	async isCurrent(fileSystemService: FileSystemService): Promise<boolean> {
		for (const [file, bytes] of this.before)
			if (!sameBytes(await bytesOf(fileSystemService, file), bytes))
				return false;
		return true;
	}
}

/** `changes` without a removal inside a folder another one removes, as `--list` shows them. */
export function withoutRemovedInside(
	changes: readonly SyncbackChange[]
): SyncbackChange[] {
	const removed = new Set(
		changes.filter(({ kind }) => kind === "remove").map(({ file }) => file)
	);
	return changes.filter(
		({ kind, file }) =>
			kind !== "remove" ||
			![...ancestors(file)].some((dir) => removed.has(dir))
	);
}

export function sameBytes(
	a: Uint8Array | undefined,
	b: Uint8Array | undefined
): boolean {
	if (a === b) return true;
	if (a === undefined || b === undefined || a.length !== b.length)
		return false;
	for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return false;
	return true;
}

/** The bytes of `file`, or none when it isn't there. */
export async function bytesOf(
	fileSystemService: FileSystemService,
	file: string
): Promise<Uint8Array | undefined> {
	return (await fileSystemService.isFile(file))
		? await fileSystemService.readFileBytes(file)
		: undefined;
}

/** Each instance once, under its strongest kind, a folder before what it holds; none below a removed one, nor a new one below a new one. */
function outermost(changes: readonly CompiledChange[]): CompiledChange[] {
	// An instance Rojo rewrote in another form is gone in its old one, but still there.
	const strength = { removed: 0, changed: 1, added: 2 } as const;
	const kinds = new Map<string, CompiledChange["kind"]>();
	for (const { instance, kind } of changes) {
		const listed = kinds.get(instance);
		if (listed === undefined || strength[kind] > strength[listed])
			kinds.set(instance, kind);
	}
	return [...kinds]
		.filter(([instance, kind]) => {
			const names = instance.split("/");
			return !names.slice(1).some((_, depth) => {
				const above = kinds.get(instanceKey(names.slice(0, depth + 1)));
				return (
					above === "removed" ||
					(above === "added" && kind === "added")
				);
			});
		})
		.map(([instance, kind]) => ({ instance, kind }))
		.sort((a, b) => {
			const [left, right] = [a, b].map(({ instance }) =>
				instance.split("/")
			);
			for (let at = 0; at < Math.min(left.length, right.length); at++)
				if (left[at] !== right[at])
					return compareStrings(left[at], right[at]);
			return left.length - right.length;
		});
}
