const { parseCliArgs } = require("../src/cli");

describe("CLI Argument Parsing", () => {
	it("should parse full flags correctly", () => {
		const args = ["--mode", "ts", "--source", "my_src", "--watch"];
		const options = parseCliArgs(args);
		
		expect(options.mode).toBe("ts");
		expect(options.source).toEqual(["my_src"]);
		expect(options.watch).toBe(true);
	});

	it("should parse short aliases correctly", () => {
		const args = ["-m", "luau", "-s", "other_src", "-w"];
		const options = parseCliArgs(args);
		
		expect(options.mode).toBe("luau");
		expect(options.source).toEqual(["other_src"]);
		expect(options.watch).toBe(true);
	});

	it("should parse multiple source flags correctly", () => {
		const args = ["-s", "src/core", "-s", "src/chapter1"];
		const options = parseCliArgs(args);
		
		expect(options.source).toEqual(["src/core", "src/chapter1"]); // New multi-source test
	});

	it("should return undefined for omitted flags", () => {
		const args = ["--mode", "darklua"];
		const options = parseCliArgs(args);
		
		expect(options.mode).toBe("darklua");
		expect(options.watch).toBeUndefined();
	});

	it("should parse keepSuffixes flag correctly", () => {
		const args1 = ["--keepSuffixes"];
		const options1 = parseCliArgs(args1);
		expect(options1.keepSuffixes).toBe(true);

		const args2 = ["-k"];
		const options2 = parseCliArgs(args2);
		expect(options2.keepSuffixes).toBe(true);
	});

	it("should parse init flag correctly", () => {
		const args1 = ["--init"];
		const options1 = parseCliArgs(args1);
		expect(options1.init).toBe(true);

		const args2 = ["-i"];
		const options2 = parseCliArgs(args2);
		expect(options2.init).toBe(true);
	});
});