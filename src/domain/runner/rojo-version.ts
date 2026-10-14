const VERSION = /(\d+)\.(\d+)(?:\.(\d+))?/;

/** A release number such as 7.7.1, or 7.7 for 7.7.0; a pre-release tag is not part of it. */
export class RojoVersion {
	private constructor(
		readonly major: number,
		readonly minor: number,
		readonly patch: number
	) {}

	static parse(text: string): RojoVersion | undefined {
		const found = VERSION.exec(text);
		return found
			? new RojoVersion(
					Number(found[1]),
					Number(found[2]),
					Number(found[3] ?? 0)
				)
			: undefined;
	}

	/** For a version written in the code, which is always well formed. */
	static of(text: string): RojoVersion {
		const version = RojoVersion.parse(text);
		if (!version) throw new Error(`${text} is not a version.`);
		return version;
	}

	isBefore(other: RojoVersion): boolean {
		return this.major !== other.major
			? this.major < other.major
			: this.minor !== other.minor
				? this.minor < other.minor
				: this.patch < other.patch;
	}

	toString(): string {
		return `${this.major}.${this.minor}.${this.patch}`;
	}
}
