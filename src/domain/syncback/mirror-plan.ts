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

export type Operation = {
	readonly file: string;
	readonly instance: string;
	readonly from?: string;
} & (
	| { readonly kind: "write"; readonly bytes: Uint8Array }
	| { readonly kind: "folder" }
	| { readonly kind: "remove" }
	| { readonly kind: "prune" }
);

export interface Expected {
	readonly file: string;
	readonly instance: readonly string[];
}

export class MirrorPlan implements SyncbackPlan {
	readonly changes: readonly SyncbackChange[];
	readonly compiled: readonly CompiledChange[];

	constructor(
		readonly project: ResolvedConfig,
		readonly unplaced: readonly UnplacedInstance[],
		compiled: readonly CompiledChange[],
		readonly operations: readonly Operation[],
		private readonly before: ReadonlyMap<string, Uint8Array | undefined>,
		readonly expected: readonly Expected[],
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

	async isCurrent(fileSystemService: FileSystemService): Promise<boolean> {
		for (const [file, bytes] of this.before)
			if (!sameBytes(await bytesOf(fileSystemService, file), bytes))
				return false;
		return true;
	}
}

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

export async function bytesOf(
	fileSystemService: FileSystemService,
	file: string
): Promise<Uint8Array | undefined> {
	return (await fileSystemService.isFile(file))
		? await fileSystemService.readFileBytes(file)
		: undefined;
}

function outermost(changes: readonly CompiledChange[]): CompiledChange[] {
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
