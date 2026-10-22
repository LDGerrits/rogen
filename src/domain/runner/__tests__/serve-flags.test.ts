import { ServeFlags } from "../serve-flags.js";

describe("domain/runner/serve-flags", () => {
	describe("portIn", () => {
		it.each([
			[["--port", "34873"], 34873],
			[["--port=34873"], 34873],
			[["--address", "0.0.0.0"], undefined],
		])("should read Rojo's port from %j", (args, port) => {
			expect(ServeFlags.portIn(args).unwrap()).toBe(port);
		});

		it.each([["x"], ["70000"], ["0"]])(
			"should refuse the value %s as a port",
			(value) => {
				expect(ServeFlags.portIn(["--port", value]).isErr()).toBe(true);
			}
		);
	});

	describe("hostIn", () => {
		it("should read Rojo's own host flag", () => {
			expect(ServeFlags.hostIn(["--address", "0.0.0.0"])).toBe("0.0.0.0");
			expect(ServeFlags.hostIn(["--host", "x"])).toBeUndefined();
		});
	});

	describe("withoutPort", () => {
		it("should drop the port flag and its value, however it is written", () => {
			expect(
				ServeFlags.withoutPort([
					"--address",
					"x",
					"--port",
					"1",
					"--port=2",
					"-v",
				])
			).toEqual(["--address", "x", "-v"]);
		});
	});

	describe("tooNewIn", () => {
		it("should name a flag the version rejects, with the release that added it", () => {
			const found = ServeFlags.tooNewIn(["--allowed-hosts=lan"], "7.6.1");

			expect(found?.flag).toBe("--allowed-hosts");
			expect(found?.since.toString()).toBe("7.7.0");
		});

		it.each([
			["a version that has it", ["--allowed-hosts", "lan"], "7.7.0"],
			["no such flag", ["--address", "x"], "7.6.1"],
			["a version that isn't one", ["--allowed-hosts", "lan"], "nightly"],
		])("should find nothing for %s", (_, args, version) => {
			expect(ServeFlags.tooNewIn(args, version)).toBeUndefined();
		});
	});
});
