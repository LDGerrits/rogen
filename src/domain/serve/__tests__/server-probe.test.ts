import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { ServeAddress, SyncServer } from "../serve.js";
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
		expect(requests.requested).toEqual([
			"http://127.0.0.1:34872/api/rojo",
			"http://127.0.0.1:34872/details",
		]);
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

	it("should find an Argon server on a port Rojo was asked about", async () => {
		requests.responses.set("http://127.0.0.1:34872/api/rojo", {
			status: 302,
			contentType: undefined,
			body: new Uint8Array(),
		});
		requests.answer("http://127.0.0.1:34872/details", {
			name: "Game",
			version: "2.0.24",
		});

		const state = await probe.probe(
			new ServeAddress("127.0.0.1", 34872),
			SyncServer.ROJO
		);

		expect(state).toEqual({
			kind: "serving",
			info: {
				server: SyncServer.ARGON,
				project: "Game",
				version: "2.0.24",
			},
		});
	});

	it("should find a port that answers as no sync server taken", async () => {
		requests.responses.set("http://127.0.0.1:8000/details", "timeout");
		requests.responses.set("http://127.0.0.1:8000/api/rojo", {
			status: 404,
			contentType: "text/html",
			body: new Uint8Array(),
		});

		expect(
			await probe.probe(
				new ServeAddress("127.0.0.1", 8000),
				SyncServer.ARGON
			)
		).toEqual({ kind: "taken" });
	});

	it("should try IPv6 loopback for localhost", async () => {
		requests.answer("http://[::1]:8000/details", {
			name: "Game",
			version: "2.0.24",
		});

		const state = await probe.probe(
			new ServeAddress("localhost", 8000),
			SyncServer.ARGON
		);

		expect(state.kind).toBe("serving");
		expect(requests.requested.slice(0, 1)).toEqual([
			"http://127.0.0.1:8000/details",
		]);
	});
});
