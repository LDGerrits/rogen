import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { SyncServer } from "../../runner/sync-server.js";
import { ServeAddress } from "../serve.js";
import { ServerProbe } from "../server-probe.js";

describe("ServerProbe", () => {
	let requests: MockRequestService;
	let probe: ServerProbe;

	beforeEach(() => {
		requests = new MockRequestService();
		probe = new ServerProbe(requests);
	});

	it("should find a port nothing listens on free", async () => {
		expect(
			await probe.probe(
				new ServeAddress("127.0.0.1", 34872),
				SyncServer.ROJO
			)
		).toEqual({ kind: "free" });
		expect(requests.requested).toEqual(["http://127.0.0.1:34872/api/rojo"]);
	});

	it("should say what a Rojo server serves", async () => {
		requests.answer("http://127.0.0.1:34872/api/rojo", {
			projectName: "Game",
			serverVersion: "7.7.1",
			sessionId: "s",
		});

		expect(
			await probe.probe(
				new ServeAddress("127.0.0.1", 34872),
				SyncServer.ROJO
			)
		).toEqual({
			kind: "serving",
			info: {
				server: SyncServer.ROJO,
				project: "Game",
				version: "7.7.1",
				session: "s",
			},
		});
	});

	it("should find a port that answers as no sync server taken", async () => {
		requests.responses.set("http://127.0.0.1:8000/api/rojo", {
			status: 404,
			contentType: "text/html",
			body: new Uint8Array(),
		});

		expect(
			await probe.probe(
				new ServeAddress("127.0.0.1", 8000),
				SyncServer.ROJO
			)
		).toEqual({ kind: "taken" });
	});

	it("should find a port that answers with something else taken", async () => {
		requests.answer("http://127.0.0.1:8000/api/rojo", { hello: "world" });

		expect(
			await probe.probe(
				new ServeAddress("127.0.0.1", 8000),
				SyncServer.ROJO
			)
		).toEqual({ kind: "taken" });
	});

	it("should find a port that does not answer in time taken", async () => {
		requests.responses.set("http://127.0.0.1:8000/api/rojo", "timeout");

		expect(
			await probe.probe(
				new ServeAddress("127.0.0.1", 8000),
				SyncServer.ROJO
			)
		).toEqual({ kind: "taken" });
	});

	it("should try IPv6 loopback for localhost", async () => {
		requests.answer("http://[::1]:8000/api/rojo", {
			projectName: "Game",
			serverVersion: "7.7.1",
		});

		const state = await probe.probe(
			new ServeAddress("localhost", 8000),
			SyncServer.ROJO
		);

		expect(state.kind).toBe("serving");
		expect(requests.requested.slice(0, 1)).toEqual([
			"http://127.0.0.1:8000/api/rojo",
		]);
	});
});
