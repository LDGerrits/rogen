/** Where a server listens. */
export class ServeAddress {
	constructor(
		readonly host: string,
		readonly port: number
	) {}

	/** The hosts to reach it at: a server listening on every interface or on `localhost` answers on loopback. */
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

	/** Whether it listens on this machine's loopback, where a free port can be looked for. */
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

	/** `path` on this address, reached at `host`. */
	urlAt(host: string, path: string): string {
		return `http://${host.includes(":") ? `[${host}]` : host}:${this.port}${path}`;
	}

	toString(): string {
		return `${this.host}:${this.port}`;
	}
}
