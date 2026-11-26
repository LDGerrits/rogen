import { compareByCodePoint } from "../../base/collections.js";
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

const KIND_PRECEDENCE: Readonly<Record<CompiledChange["kind"], number>> = {
	removed: 0,
	changed: 1,
	added: 2,
};

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

/** A file of the instance that a refused move came from, as Studio left it. */
export interface MovedFile {
	readonly bytes: Uint8Array;
	/** Its path below the instance's folder, unless it is the instance's file. */
	readonly rel?: string;
}

/**
 * What a syncback run means to do with one file or instance. A run records
 * them in order and never takes one back; a hold keeps what a removal would
 * have taken, whenever it was recorded.
 */
export type Intent =
	| {
			readonly kind: "write";
			readonly instance: string;
			readonly file: string;
			readonly bytes: Uint8Array;
			readonly from?: string;
	  }
	| {
			readonly kind: "folder";
			readonly instance: string;
			readonly file: string;
			readonly from?: string;
	  }
	| {
			readonly kind: "gone";
			readonly instance: string;
			readonly file: string;
			readonly from?: string;
			/** A folder, removed only once it is empty. */
			readonly folder?: true;
	  }
	| {
			readonly kind: "hold";
			readonly instance: string;
			readonly files: readonly string[];
			readonly reason: string;
	  }
	| {
			readonly kind: "hold";
			readonly instance: string;
			readonly files: "movedFrom";
			readonly moved: readonly MovedFile[];
			readonly reason: string;
	  };

export type GoneIntent = Extract<Intent, { kind: "gone" }>;

export type HoldIntent = Extract<Intent, { kind: "hold" }>;

export function intentOf(operation: Operation): Intent {
	switch (operation.kind) {
		case "write":
		case "folder":
			return operation;
		case "remove":
			return { ...operation, kind: "gone" };
		case "prune":
			return { ...operation, kind: "gone", folder: true };
	}
}

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
	const kinds = new Map<string, CompiledChange["kind"]>();
	for (const { instance, kind } of changes) {
		const listed = kinds.get(instance);
		if (
			listed === undefined ||
			KIND_PRECEDENCE[kind] > KIND_PRECEDENCE[listed]
		)
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
					return compareByCodePoint(left[at], right[at]);
			return left.length - right.length;
		});
}
