import { FIRST_PLACE_PORT } from "./config.js";

/** The ports places are served on when they pin none. */
export class PlacePorts {
	/** For each place in the order given, `undefined` when it pins a port, else the first port from 34872 that no place pins and no earlier place took. */
	static assign(
		pinned: readonly (number | undefined)[]
	): (number | undefined)[] {
		const taken = new Set(pinned.filter((port) => port !== undefined));
		let next = FIRST_PLACE_PORT;
		return pinned.map((port) => {
			if (port !== undefined) return undefined;
			while (taken.has(next)) next++;
			return next++;
		});
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
