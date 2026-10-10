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
		it("should find a server by id in any case", () => {
			expect(SyncServer.byId("Argon")).toBe(SyncServer.ARGON);
			expect(SyncServer.byId("lune")).toBeUndefined();
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
