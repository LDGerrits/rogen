import { ServeAddress } from "../serve.js";

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
