import { Proposal } from "./draft-routing.js";
import { Operation, sameBytes } from "./mirror-plan.js";

export interface Choice<C extends Proposal> {
	readonly instance: string;
	readonly candidates: readonly C[];
	readonly reason: string;
}

export interface Placements<C extends Proposal, H extends Choice<C>> {
	readonly placed: readonly { readonly choice: H; readonly candidate: C }[];
	readonly refused: readonly {
		readonly choice: H;
		readonly reason: string;
	}[];
}

/** Why each candidate it was given would not land as proposed. */
export type Verify<C extends Proposal> = (
	chosen: readonly C[]
) => Promise<ReadonlyMap<C, string>>;

const clashes = (operation: Operation, other: Operation | undefined) =>
	other !== undefined &&
	(operation.kind === "write"
		? other.kind !== "write" || !sameBytes(other.bytes, operation.bytes)
		: other.kind === "write");

/**
 * Takes each choice's first candidate that clashes with no earlier choice's
 * files and that verify passes, verifying every pick together until none
 * misses. A choice left without a candidate is refused for its first miss,
 * else for its last clash, else for its own reason.
 */
export async function settle<C extends Proposal, H extends Choice<C>>(
	choices: readonly H[],
	verify: Verify<C>
): Promise<Placements<C, H>> {
	const at = choices.map(() => 0);
	const reasons = choices.map(({ reason }) => reason);
	const firstMisses: (string | undefined)[] = choices.map(() => undefined);
	for (;;) {
		const taken = new Map<string, Operation>();
		const chosen = choices.map(({ candidates }, index) => {
			for (; at[index] < candidates.length; at[index]++) {
				const candidate = candidates[at[index]];
				const clash = candidate.operations.find((operation) =>
					clashes(operation, taken.get(operation.file))
				);
				if (clash) {
					reasons[index] = `${clash.file} is already there`;
					continue;
				}
				for (const operation of candidate.operations)
					if (
						operation.kind === "write" ||
						operation.kind === "folder"
					)
						taken.set(operation.file, operation);
				return candidate;
			}
			return undefined;
		});
		const misses = await verify(
			chosen.filter((candidate) => candidate !== undefined)
		);
		let anyMissed = false;
		chosen.forEach((candidate, index) => {
			const miss = candidate && misses.get(candidate);
			if (miss === undefined) return;
			firstMisses[index] ??= miss;
			at[index]++;
			anyMissed = true;
		});
		if (anyMissed) continue;
		return {
			placed: chosen.flatMap((candidate, index) =>
				candidate ? [{ choice: choices[index], candidate }] : []
			),
			refused: chosen.flatMap((candidate, index) =>
				candidate
					? []
					: [
							{
								choice: choices[index],
								reason: firstMisses[index] ?? reasons[index],
							},
						]
			),
		};
	}
}
