import { SERVER_NAMES } from "../../config/config.js";
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

		it("should read what Argon's details endpoint says", () => {
			expect(
				SyncServer.ARGON.readInfo({
					version: "2.0.24",
					name: "Game",
					gameId: null,
					placeIds: [],
				})
			).toEqual({
				server: SyncServer.ARGON,
				project: "Game",
				version: "2.0.24",
			});
		});

		it("should not read another server's answer", () => {
			expect(
				SyncServer.ARGON.readInfo({
					serverVersion: "7.7.1",
					projectName: "Game",
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

		it("should read Argon's short flag with the value attached", () => {
			expect(SyncServer.ARGON.portIn(["-P8001"]).unwrap()).toBe(8001);
			expect(SyncServer.ARGON.portIn(["-Pabc"]).isErr()).toBe(true);
		});

		it("should read Argon's short flag, and take the last one given", () => {
			expect(
				SyncServer.ARGON.portIn([
					"-P",
					"8001",
					"--port",
					"8002",
				]).unwrap()
			).toBe(8002);
			expect(SyncServer.ARGON.portIn(["-P", "8001"]).unwrap()).toBe(8001);
		});
	});

	describe("hostIn", () => {
		it("should read Argon's short host flag with the value attached", () => {
			expect(SyncServer.ARGON.hostIn(["-H0.0.0.0"])).toBe("0.0.0.0");
		});

		it("should read each server's own host flag", () => {
			expect(SyncServer.ROJO.hostIn(["--address", "0.0.0.0"])).toBe(
				"0.0.0.0"
			);
			expect(SyncServer.ARGON.hostIn(["-H", "127.0.0.1"])).toBe(
				"127.0.0.1"
			);
			expect(SyncServer.ROJO.hostIn(["--host", "x"])).toBeUndefined();
		});
	});

	describe("byId", () => {
		it("should find a server by its id, as the config spells it", () => {
			expect(SyncServer.byId("argon")).toBe(SyncServer.ARGON);
			expect(SyncServer.byId("Argon")).toBeUndefined();
			expect(SyncServer.byId("lune")).toBeUndefined();
		});

		it("should know every server a config can name", () => {
			expect(
				SERVER_NAMES.map((name) => SyncServer.byId(name)?.id)
			).toEqual(SyncServer.ALL.map(({ id }) => id));
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
			["Argon", SyncServer.ARGON, "2.0.29", false],
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

		it("should read nothing from Argon, which says nothing of them", () => {
			expect(
				SyncServer.ARGON.connectionIn(
					"WebSocket subscription established for session 1"
				)
			).toBeUndefined();
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

		it("should ask Argon for nothing", () => {
			expect(SyncServer.ARGON.env).toEqual({});
		});
	});

	describe("serveArgs", () => {
		it("should serve the project file, with the tool args last", () => {
			expect(
				SyncServer.ROJO.serveArgs("lobby.project.json", ["--port", "1"])
			).toEqual(["serve", "lobby.project.json", "--port", "1"]);
		});

		it("should keep Argon in the foreground, even when its settings run it async", () => {
			expect(
				SyncServer.ARGON.serveArgs("lobby.project.json", ["--async"])
			).toEqual([
				"serve",
				"lobby.project.json",
				"--argon-spawn",
				"--async",
			]);
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
