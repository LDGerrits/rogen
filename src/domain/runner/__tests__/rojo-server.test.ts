import { LogLevel } from "../../../platform/log/log-service.js";
import { RojoServer } from "../rojo-server.js";

describe("domain/runner/rojo-server", () => {
	describe("readInfo", () => {
		it("should read what Rojo's info endpoint says", () => {
			expect(
				RojoServer.readInfo({
					sessionId: "1bb6",
					serverVersion: "7.7.1",
					protocolVersion: 5,
					projectName: "Game",
				})
			).toEqual({
				project: "Game",
				version: "7.7.1",
				session: "1bb6",
			});
		});

		it("should not read another server's answer", () => {
			expect(
				RojoServer.readInfo({ version: "2.0.24", name: "Game" })
			).toBeUndefined();
			expect(RojoServer.readInfo("Home Page")).toBeUndefined();
		});
	});

	describe("reportsConnections", () => {
		it.each([
			["Rojo 7.7.1", "7.7.1", true],
			["Rojo 7.7.0", "7.7.0", true],
			["a later Rojo major", "8.0.0", true],
			["Rojo 7.10.2", "7.10.2", true],
			["Rojo 7.6.1, which long-polls", "7.6.1", false],
			["a release candidate", "7.7.0-rc.1", true],
			["a version of two numbers", "7.7", true],
			["a version that isn't one", "nightly", false],
		])("should say whether %s reports them", (_, version, reports) => {
			expect(RojoServer.reportsConnections(version)).toBe(reports);
		});
	});

	describe("connectionIn", () => {
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
			expect(RojoServer.connectionIn(line)).toBe(change);
		});
	});

	describe("logEnv", () => {
		it.each([
			["nothing set", undefined, "info,librojo::web=debug"],
			["the user's filter", "warn", "warn,librojo::web=debug"],
		])(
			"should ask Rojo for the debug lines of its web server beside %s",
			(_, inherited, expected) => {
				expect(
					RojoServer.logEnv(LogLevel.Info).RUST_LOG(inherited)
				).toBe(expected);
			}
		);

		it.each([
			[LogLevel.Error, "info,librojo::web=debug"],
			[LogLevel.Info, "info,librojo::web=debug"],
			[LogLevel.Debug, "info,librojo=debug"],
			[LogLevel.Trace, "info,librojo=trace"],
		])(
			"should ask Rojo for what its -v flags show at log level %s",
			(level, expected) => {
				expect(RojoServer.logEnv(level).RUST_LOG(undefined)).toBe(
					expected
				);
			}
		);

		it("should keep the user's filter over the log level", () => {
			expect(RojoServer.logEnv(LogLevel.Trace).RUST_LOG("warn")).toBe(
				"warn,librojo::web=debug"
			);
		});
	});
});
