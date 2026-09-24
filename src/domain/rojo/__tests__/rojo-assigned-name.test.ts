import {
	rojoAssignedName,
	rojoModelName,
	stripRojoDataSuffix,
} from "../rojo-assigned-name.js";

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

describe("rojoModelName", () => {
	it("strips a trailing .model", () => {
		expect(rojoModelName("Gun.model")).toBe("Gun");
	});

	it("leaves any other stem untouched", () => {
		expect(rojoModelName("Gun")).toBe("Gun");
		expect(rojoModelName("Gun.model.mock")).toBe("Gun.model.mock");
	});
});

describe("stripRojoDataSuffix", () => {
	it("strips a trailing .model or .project", () => {
		expect(stripRojoDataSuffix("Gun.model")).toBe("Gun");
		expect(stripRojoDataSuffix("Outer.project")).toBe("Outer");
	});

	it("leaves a stem that is only the suffix, and any other stem", () => {
		expect(stripRojoDataSuffix(".model")).toBe(".model");
		expect(stripRojoDataSuffix("Gun.model.mock")).toBe("Gun.model.mock");
	});
});
