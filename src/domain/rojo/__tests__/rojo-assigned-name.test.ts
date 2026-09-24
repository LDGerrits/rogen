import { rojoAssignedName } from "../rojo-assigned-name.js";

describe("rojoAssignedName", () => {
	it("strips a trailing .client", () => {
		expect(rojoAssignedName("main.client")).toBe("main");
	});

	it("strips a trailing .plugin", () => {
		expect(rojoAssignedName("main.plugin")).toBe("main");
	});

	it("strips a trailing .server", () => {
		expect(rojoAssignedName("main.server")).toBe("main");
	});

	it("leaves a non-trailing .server untouched, matching Rojo", () => {
		expect(rojoAssignedName("Foo.server.mock")).toBe("Foo.server.mock");
	});

	it("leaves any other suffix untouched", () => {
		expect(rojoAssignedName("Types.shared")).toBe("Types.shared");
	});

	it("does not know about declared keys at all", () => {
		expect(rojoAssignedName("Save+mock.server")).toBe("Save+mock");
	});
});
