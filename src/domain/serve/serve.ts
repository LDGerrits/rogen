export class ServeAddress {
	constructor(
		readonly host: string,
		readonly port: number
	) {}

	get loopbackHosts(): string[] {
		switch (this.host) {
			case "0.0.0.0":
				return ["127.0.0.1"];
			case "::":
			case "[::]":
				return ["::1", "127.0.0.1"];
			case "localhost":
				return ["127.0.0.1", "::1"];
			default:
				return [this.host.replace(/^\[(.*)\]$/, "$1")];
		}
	}

	get isLocal(): boolean {
		return [
			"127.0.0.1",
			"localhost",
			"0.0.0.0",
			"::",
			"[::]",
			"::1",
		].includes(this.host);
	}

	urlAt(host: string, path: string): string {
		return `http://${host.includes(":") ? `[${host}]` : host}:${this.port}${path}`;
	}

	/** The address as Rojo's banner shows it: `localhost` for a loopback host. */
	get shown(): string {
		const bare = this.host.replace(/^\[(.*)\]$/, "$1");
		return /^127\./.test(bare) || bare === "::1"
			? `localhost:${this.port}`
			: this.toString();
	}

	/** Where a browser reaches it, as Rojo's banner says. */
	get url(): string {
		return `http://${this.shown}/`;
	}

	toString(): string {
		const bare = this.host.replace(/^\[(.*)\]$/, "$1");
		return `${bare.includes(":") ? `[${bare}]` : bare}:${this.port}`;
	}
}
