import { capitalized } from "../string.js";

describe("capitalized", () => {
	it("should uppercase the first letter and keep the rest", () => {
		expect(capitalized("client")).toBe("Client");
		expect(capitalized("mockData")).toBe("MockData");
		expect(capitalized("Server")).toBe("Server");
	});
});
