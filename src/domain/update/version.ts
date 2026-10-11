/** A release's version, `major.minor.patch` with a dotted prerelease after a dash, ordered as semver orders them. */
export class Version {
	private constructor(
		private readonly numbers: readonly [number, number, number],
		private readonly prerelease: readonly string[]
	) {}

	/** `undefined` for any text that isn't a version. Build metadata after a plus is dropped. */
	static parse(text: string): Version | undefined {
		const match =
			/^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(
				text.trim()
			);
		if (!match) return undefined;
		return new Version(
			[Number(match[1]), Number(match[2]), Number(match[3])],
			match[4]?.split(".") ?? []
		);
	}

	get isPrerelease(): boolean {
		return this.prerelease.length > 0;
	}

	/** Negative when this is older than `other`, positive when newer, and 0 when they are the same release. */
	compareTo(other: Version): number {
		for (let i = 0; i < 3; i++) {
			const difference = this.numbers[i] - other.numbers[i];
			if (difference !== 0) return difference;
		}
		// A prerelease comes before the release it leads up to.
		if (!this.isPrerelease || !other.isPrerelease)
			return other.prerelease.length - this.prerelease.length;
		for (
			let i = 0;
			i < Math.min(this.prerelease.length, other.prerelease.length);
			i++
		) {
			const difference = compareIdentifiers(
				this.prerelease[i],
				other.prerelease[i]
			);
			if (difference !== 0) return difference;
		}
		return this.prerelease.length - other.prerelease.length;
	}

	toString(): string {
		const base = this.numbers.join(".");
		return this.isPrerelease
			? `${base}-${this.prerelease.join(".")}`
			: base;
	}
}

const isNumeric = (identifier: string) => /^\d+$/.test(identifier);

/** Numbers compare as numbers and go before words, which compare as text. */
function compareIdentifiers(a: string, b: string): number {
	if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
	if (isNumeric(a)) return -1;
	if (isNumeric(b)) return 1;
	return a < b ? -1 : a > b ? 1 : 0;
}
