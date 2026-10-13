import { ServeAddress, SyncServer } from "../serve.js";

describe("SyncServer", () => {
	describe("readInfo", () => {
		it("should read what Rojo's info endpoint says", () => {
			expect(
				SyncServer.ROJO.readInfo({
					sessionId: "1bb6",
					serverVersion: "7.7.1",
					protocolVersion: 5,
					projectName: "Game",
				})
			).toEqual({
				server: SyncServer.ROJO,
				project: "Game",
				version: "7.7.1",
				session: "1bb6",
			});
		});

		it("should not read another server's answer", () => {
			expect(
				SyncServer.ROJO.readInfo({
					version: "2.0.24",
					name: "Game",
				})
			).toBeUndefined();
			expect(SyncServer.ROJO.readInfo("Home Page")).toBeUndefined();
		});
	});

	describe("portIn", () => {
		it.each([
			[["--port", "34873"], 34873],
			[["--port=34873"], 34873],
			[["--address", "0.0.0.0"], undefined],
		])("should read Rojo's port from %j", (args, port) => {
			expect(SyncServer.ROJO.portIn(args).unwrap()).toBe(port);
		});

		it.each([["x"], ["70000"], ["0"]])(
			"should refuse the value %s as a port",
			(value) => {
				expect(SyncServer.ROJO.portIn(["--port", value]).isErr()).toBe(
					true
				);
			}
		);
	});

	describe("hostIn", () => {
		it("should read Rojo's own host flag", () => {
			expect(SyncServer.ROJO.hostIn(["--address", "0.0.0.0"])).toBe(
				"0.0.0.0"
			);
			expect(SyncServer.ROJO.hostIn(["--host", "x"])).toBeUndefined();
		});
	});

	describe("byId", () => {
		it("should find Rojo by its id, as a record spells it", () => {
			expect(SyncServer.byId("rojo")).toBe(SyncServer.ROJO);
			expect(SyncServer.byId("Rojo")).toBeUndefined();
			expect(SyncServer.byId("argon")).toBeUndefined();
		});
	});

	describe("connections", () => {
		it.each([
			["Rojo 7.7.1", SyncServer.ROJO, "7.7.1", true],
			["Rojo 7.7.0", SyncServer.ROJO, "7.7.0", true],
			["a later Rojo major", SyncServer.ROJO, "8.0.0", true],
			["Rojo 7.10.2", SyncServer.ROJO, "7.10.2", true],
			["Rojo 7.6.1, which long-polls", SyncServer.ROJO, "7.6.1", false],
			["a release candidate", SyncServer.ROJO, "7.7.0-rc.1", true],
			["a version of two numbers", SyncServer.ROJO, "7.7", true],
			["a version that isn't one", SyncServer.ROJO, "nightly", false],
		])(
			"should say whether %s reports them",
			(_, server, version, reports) => {
				expect(server.reportsConnections(version)).toBe(reports);
			}
		);

		it.each([
			[
				"WebSocket subscription established for session 0ea352f4",
				"opened",
			],
			["WebSocket subscription closed by client", "closed"],
			["WebSocket subscription closed by client ", "closed"],
			["WebSocket stream ended", "closed"],
			[
				"WebSocket error: WebSocket protocol error: Connection reset without closing handshake",
				"closed",
			],
			[
				"Message queue disconnected; closing WebSocket subscription",
				"closed",
			],
			[
				"Sending batch of messages over WebSocket subscription",
				undefined,
			],
			["Rojo server listening:", undefined],
		])("should read %j from Rojo as %s", (line, change) => {
			expect(SyncServer.ROJO.connectionIn(line)).toBe(change);
		});

		it.each([
			["nothing set", undefined, "info,librojo::web=debug"],
			["the user's filter", "warn", "warn,librojo::web=debug"],
		])(
			"should ask Rojo for the debug lines of its web server beside %s",
			(_, inherited, expected) => {
				expect(SyncServer.ROJO.env.RUST_LOG(inherited)).toBe(expected);
			}
		);
	});

	describe("serveArgs", () => {
		it("should serve the project file, with the tool args last", () => {
			expect(
				SyncServer.ROJO.serveArgs("lobby.project.json", ["--port", "1"])
			).toEqual(["serve", "lobby.project.json", "--port", "1"]);
		});
	});
});

describe("ServeAddress", () => {
	it.each([
		["0.0.0.0", ["127.0.0.1"]],
		["localhost", ["127.0.0.1", "::1"]],
		["::", ["::1", "127.0.0.1"]],
		["192.168.1.2", ["192.168.1.2"]],
	])("should reach %s at %j", (host, hosts) => {
		expect(new ServeAddress(host, 34872).loopbackHosts).toEqual(hosts);
	});

	it("should bracket an IPv6 host in a URL", () => {
		expect(new ServeAddress("::", 34872).urlAt("::1", "/api/rojo")).toBe(
			"http://[::1]:34872/api/rojo"
		);
		expect(
			new ServeAddress("localhost", 8000).urlAt("127.0.0.1", "/details")
		).toBe("http://127.0.0.1:8000/details");
	});
});
