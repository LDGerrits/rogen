import { parseCliArgs } from "../src/cli.js";
import { jest } from "@jest/globals";

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

		expect(options.source).toEqual(["src/core", "src/chapter1"]);
	});

	it("should return undefined for omitted flags", () => {
		const args = ["--mode", "darklua"];
		const options = parseCliArgs(args);

		expect(options.mode).toBe("darklua");
		expect(options.watch).toBeUndefined();
	});

	it("should parse init flag correctly", () => {
		const args1 = ["--init"];
		const options1 = parseCliArgs(args1);
		expect(options1.init).toBe(true);

		const args2 = ["-i"];
		const options2 = parseCliArgs(args2);
		expect(options2.init).toBe(true);
	});

	it("should parse version flag correctly", () => {
		const args1 = ["--version"];
		const options1 = parseCliArgs(args1);
		expect(options1.version).toBe(true);

		const args2 = ["-v"];
		const options2 = parseCliArgs(args2);
		expect(options2.version).toBe(true);
	});

	it("should parse multiple env flags correctly", () => {
		const args = ["-e", "dev", "--env", "debug"];
		const options = parseCliArgs(args);

		expect(options.env).toEqual(["dev", "debug"]);
	});

	it("should catch unknown arguments and exit gracefully with an error message", () => {
		const exitSpy = jest
			.spyOn(process, "exit")
			.mockImplementation((() => {}) as any);
		const errorSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const args = ["--unknown", "value"];
		parseCliArgs(args);

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Unknown option '--unknown'")
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Run 'rogen --help'")
		);
		expect(exitSpy).toHaveBeenCalledWith(1);

		exitSpy.mockRestore();
		errorSpy.mockRestore();
	});
});
