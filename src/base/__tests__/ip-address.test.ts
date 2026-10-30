import { IpAddress } from "../ip-address.js";

const printed = (text: string) => IpAddress.parse(text)?.toString();

describe("IpAddress", () => {
	describe("parse", () => {
		it("should read an IPv4 address as it is", () => {
			expect(printed("127.0.0.1")).toBe("127.0.0.1");
			expect(printed("0.0.0.0")).toBe("0.0.0.0");
		});

		it("should reject a host name, a short or long IPv4 address, a number over 255 and a leading zero", () => {
			expect(printed("localhost")).toBeUndefined();
			expect(printed("1.2.3")).toBeUndefined();
			expect(printed("1.2.3.4.5")).toBeUndefined();
			expect(printed("1.2.3.256")).toBeUndefined();
			expect(printed("01.2.3.4")).toBeUndefined();
			expect(printed("")).toBeUndefined();
		});

		it("should print an IPv6 address with its longest run of zero groups as ::", () => {
			expect(printed("0:0:0:0:0:0:0:1")).toBe("::1");
			expect(printed("0:0:0:0:0:0:0:0")).toBe("::");
			expect(printed("2001:0db8:0:0:1:0:0:1")).toBe("2001:db8::1:0:0:1");
			expect(printed("2001:db8:0:0:0:0:2:1")).toBe("2001:db8::2:1");
			expect(printed("FE80::A")).toBe("fe80::a");
		});

		it("should leave a single zero group as it is", () => {
			expect(printed("1:0:2:3:4:5:6:7")).toBe("1:0:2:3:4:5:6:7");
		});

		it("should print an IPv4-mapped address in dotted form", () => {
			expect(printed("::ffff:1.2.3.4")).toBe("::ffff:1.2.3.4");
			expect(printed("0:0:0:0:0:ffff:102:304")).toBe("::ffff:1.2.3.4");
		});

		it("should reject malformed IPv6 addresses", () => {
			expect(printed("1:2:3")).toBeUndefined();
			expect(printed("1::2::3")).toBeUndefined();
			expect(printed("12345::")).toBeUndefined();
			expect(printed("1:2:3:4:5:6:7:8:9")).toBeUndefined();
			expect(printed("1:2:3:4:5:6:7::8")).toBeUndefined();
			expect(printed(":1:2:3:4:5:6:7")).toBeUndefined();
			expect(printed("fe80::1%eth0")).toBeUndefined();
			expect(printed("::g")).toBeUndefined();
			expect(printed("1.2.3.4::5")).toBeUndefined();
			expect(printed("1.2.3.4::")).toBeUndefined();
		});
	});
});
