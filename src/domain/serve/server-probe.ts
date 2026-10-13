import {
	RequestService,
	isSuccess,
	readBody,
} from "../../platform/request/request-service.js";
import { ServerInfo, SyncServer } from "../runner/sync-server.js";
import { ServeAddress } from "./serve.js";

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

	/** Asks the port what `server` says it serves there. */
	async probe(address: ServeAddress, server: SyncServer): Promise<PortState> {
		let listening = false;
		for (const host of address.loopbackHosts) {
			const response = await this.requestService.request(
				address.urlAt(host, server.infoPath),
				{ timeout: PROBE_TIMEOUT_MS }
			);
			if (response.isErr()) {
				if (response.error.reason !== "refused") listening = true;
				continue;
			}
			if (!isSuccess(response.value)) {
				listening = true;
				continue;
			}
			const body = readBody(response.value);
			const info = body.isOk() && server.readInfo(body.value);
			if (info) return { kind: "serving", info };
			listening = true;
		}
		return listening ? { kind: "taken" } : { kind: "free" };
	}
}
