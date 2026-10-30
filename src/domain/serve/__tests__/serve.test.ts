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

	it.each([
		["127.0.0.1", "127.0.0.1:34872"],
		["localhost", "localhost:34872"],
		["::1", "[::1]:34872"],
		["[::1]", "[::1]:34872"],
	])("should write %s as %s", (host, written) => {
		expect(new ServeAddress(host, 34872).toString()).toBe(written);
	});

	it.each([
		["127.0.0.1", "localhost:34872", "http://localhost:34872/"],
		["127.0.0.2", "localhost:34872", "http://localhost:34872/"],
		["::1", "localhost:34872", "http://localhost:34872/"],
		["0.0.0.0", "0.0.0.0:34872", "http://0.0.0.0:34872/"],
		["::", "[::]:34872", "http://[::]:34872/"],
		["fd00::2", "[fd00::2]:34872", "http://[fd00::2]:34872/"],
		["192.168.1.2", "192.168.1.2:34872", "http://192.168.1.2:34872/"],
	])("should show %s as Rojo does, as %s at %s", (host, shown, url) => {
		const address = new ServeAddress(host, 34872);

		expect(address.shown).toBe(shown);
		expect(address.url).toBe(url);
	});
});
