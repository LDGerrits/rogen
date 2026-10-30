const IPV4 =
	/^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;
const GROUP = /^[0-9a-fA-F]{1,4}$/;

/** An IPv4 or IPv6 address as Rust's `IpAddr` reads and prints it. */
export class IpAddress {
	private constructor(private readonly text: string) {}

	/** `undefined` when `text` is no address, such as a host name, or has a zone or a leading zero in a number. */
	static parse(text: string): IpAddress | undefined {
		const v4 = IpAddress.octets(text);
		if (v4) return new IpAddress(v4.join("."));
		const groups = IpAddress.groups(text);
		return groups && new IpAddress(IpAddress.printed(groups));
	}

	toString(): string {
		return this.text;
	}

	private static octets(text: string): number[] | undefined {
		const match = IPV4.exec(text);
		if (!match) return undefined;
		const octets = match.slice(1).map(Number);
		return octets.every((octet) => octet <= 255) ? octets : undefined;
	}

	/** The eight 16-bit groups of an IPv6 address. */
	private static groups(text: string): number[] | undefined {
		const halves = text.split("::");
		if (halves.length > 2) return undefined;
		const read = (half: string): number[] | undefined => {
			if (half === "") return [];
			const parts = half.split(":");
			const last = parts[parts.length - 1];
			const octets = last.includes(".")
				? IpAddress.octets(last)
				: undefined;
			if (last.includes(".") && !octets) return undefined;
			const hex = octets ? parts.slice(0, -1) : parts;
			if (!hex.every((part) => GROUP.test(part))) return undefined;
			const groups = hex.map((part) => parseInt(part, 16));
			if (octets)
				groups.push(
					octets[0] * 256 + octets[1],
					octets[2] * 256 + octets[3]
				);
			return groups;
		};
		const [head, tail] = halves;
		const before = read(head);
		if (halves.length === 1)
			return before?.length === 8 && !text.endsWith(":")
				? before
				: undefined;
		const after = read(tail);
		if (!before || !after || before.length + after.length > 7)
			return undefined;
		return [
			...before,
			...Array<number>(8 - before.length - after.length).fill(0),
			...after,
		];
	}

	/** The groups printed as Rust does: the longest run of two or more zero groups (the first, on a tie) as `::`, and an IPv4-mapped address in dotted form. */
	private static printed(groups: readonly number[]): string {
		const hex = (list: readonly number[]) =>
			list.map((group) => group.toString(16)).join(":");
		if (
			groups.slice(0, 5).every((group) => group === 0) &&
			groups[5] === 0xffff
		) {
			const [high, low] = groups.slice(6);
			return `::ffff:${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
		}
		let start = -1;
		let length = 0;
		for (let at = 0; at < 8; at++) {
			if (groups[at] !== 0) continue;
			let end = at;
			while (end < 8 && groups[end] === 0) end++;
			if (end - at > length) {
				start = at;
				length = end - at;
			}
			at = end;
		}
		if (length < 2) return hex(groups);
		return `${hex(groups.slice(0, start))}::${hex(groups.slice(start + length))}`;
	}
}
