import {
	RequestService,
	isSuccess,
	readBody,
} from "../../platform/request/request-service.js";
import { ServeAddress, ServerInfo, SyncServer } from "./serve.js";

/** How long a port may take to answer before what listens there counts as something else. */
const PROBE_TIMEOUT_MS = 1_500;

/** What listens on a port: nothing, a sync server that says what it serves, or something else. */
export type PortState =
	| { readonly kind: "free" }
	| { readonly kind: "serving"; readonly info: ServerInfo }
	| { readonly kind: "taken" };

/** Asks a port what serves there. */
export class ServerProbe {
	constructor(private readonly requestService: RequestService) {}

	/** Asks every server's endpoint at once, since another server may hold the port; `preferred`'s answer wins. */
	async probe(
		address: ServeAddress,
		preferred: SyncServer
	): Promise<PortState> {
		const servers = [
			preferred,
			...SyncServer.ALL.filter((server) => server !== preferred),
		];
		let listening = false;
		for (const host of address.loopbackHosts) {
			const answers = await Promise.all(
				servers.map(async (server) => {
					const response = await this.requestService.request(
						address.urlAt(host, server.infoPath),
						{ timeout: PROBE_TIMEOUT_MS }
					);
					if (response.isErr())
						return response.error.reason === "refused"
							? "refused"
							: "listening";
					if (!isSuccess(response.value)) return "listening";
					const body = readBody(response.value);
					return (
						(body.isOk() && server.readInfo(body.value)) ||
						"listening"
					);
				})
			);
			const info = answers.find((answer) => typeof answer === "object");
			if (typeof info === "object") return { kind: "serving", info };
			if (answers.includes("listening")) listening = true;
		}
		return listening ? { kind: "taken" } : { kind: "free" };
	}
}
