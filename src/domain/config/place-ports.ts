import { FIRST_PLACE_PORT } from "./config.js";

/** The ports places are served on when they pin none. */
export class PlacePorts {
	/** For each place in the order given, `undefined` when it pins a port, else the first port from 34872 that no place pins, no `reserved` port is and no earlier place took. */
	static assign(
		pinned: readonly (number | undefined)[],
		reserved: Iterable<number> = []
	): (number | undefined)[] {
		const taken = new Set([
			...pinned.filter((port) => port !== undefined),
			...reserved,
		]);
		return pinned.map((port) =>
			port !== undefined ? undefined : PlacePorts.firstFree(taken)
		);
	}

	/** The first port from 34872 that is not in `taken`, which now includes it. */
	static firstFree(taken: Set<number>): number {
		let port = FIRST_PLACE_PORT;
		while (taken.has(port)) port++;
		taken.add(port);
		return port;
	}

	/** `value` when it is a port a place can pin. */
	static pinnedBy(value: unknown): number | undefined {
		return typeof value === "number" &&
			Number.isInteger(value) &&
			value > 0 &&
			value < 65536
			? value
			: undefined;
	}
}
