import { InstanceName } from "../instance-name.js";

describe("unwrapInvisibleFolder", () => {
	it("removes the parentheses and marks the folder invisible", () => {
		expect(InstanceName.unwrapInvisibleFolder("(mock)")).toEqual({
			name: "mock",
			invisible: true,
		});
	});

	it("leaves an ordinary name alone", () => {
		expect(InstanceName.unwrapInvisibleFolder("mock")).toEqual({
			name: "mock",
			invisible: false,
		});
	});

	it("ignores empty or unbalanced parentheses", () => {
		for (const name of ["()", "(mock", "mock)"])
			expect(InstanceName.unwrapInvisibleFolder(name)).toEqual({
				name,
				invisible: false,
			});
	});
});

describe("unhoisted", () => {
	it("should leave a lone ^ as a name", () => {
		expect(InstanceName.unhoisted("^")).toEqual({
			name: "^",
			hoisted: false,
		});
	});

	it("should take the ^ off a longer name", () => {
		expect(InstanceName.unhoisted("^Animate")).toEqual({
			name: "Animate",
			hoisted: true,
		});
	});
});

describe("leafName", () => {
	it("should take the script class off a script and the ^ off what is left", () => {
		expect(InstanceName.leafName("script", "^Save.server")).toEqual({
			name: "Save",
			hoisted: true,
		});
	});

	it("should leave the stem of a file that isn't a script as it is", () => {
		expect(InstanceName.leafName("data", "Items.server")).toEqual({
			name: "Items.server",
			hoisted: false,
		});
	});
});

describe("withoutSpans", () => {
	it("should cut each span out, whatever order they are given in", () => {
		expect(
			InstanceName.withoutSpans("Save@server.mock", [
				{ key: "server", start: 4, length: 7 },
				{ key: "mock", start: 11, length: 5 },
			])
		).toBe("Save");
		expect(
			InstanceName.withoutSpans("Save@server.mock", [
				{ key: "mock", start: 11, length: 5 },
				{ key: "server", start: 4, length: 7 },
			])
		).toBe("Save");
	});
});
