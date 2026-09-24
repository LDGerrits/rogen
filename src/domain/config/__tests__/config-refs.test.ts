import { ParsedArgs } from "../../../platform/environment/args.js";
import { configRefsFromArgs } from "../config-refs.js";

const refs = (args: Partial<ParsedArgs>) =>
	configRefsFromArgs({ _: ["build"], ...args });

describe("configRefsFromArgs", () => {
	it("should take the names after the command and the -c paths", () => {
		const result = refs({
			_: ["build", "lobby", "match"],
			config: ["extra.rogen.json"],
		}).unwrap();

		expect(result.names).toEqual(["lobby", "match"]);
		expect(result.paths).toEqual(["extra.rogen.json"]);
	});

	it("should carry the overrides, with tags as on and off", () => {
		const result = refs({
			"out-file": "out.project.json",
			"sync-dir": "dist",
			template: "base.project.json",
			tag: ["mock", "dev"],
			"no-tag": ["prod"],
		}).unwrap();

		expect(result.overrides).toEqual({
			outFile: "out.project.json",
			syncDir: "dist",
			template: "base.project.json",
			tags: { mock: true, dev: true, prod: false },
		});
	});

	it("should carry no overrides when no flag is given", () => {
		expect(refs({}).unwrap().overrides).toEqual({ tags: {} });
	});

	it.each([
		["-o", { "out-file": "a.json" }],
		["-s", { "sync-dir": "dist" }],
		["--template", { template: "t.json" }],
	] as const)(
		"should reject %s with several names",
		(_flag, flags: Partial<ParsedArgs>) => {
			const result = refs({ _: ["build", "lobby", "match"], ...flags });

			expect(result.isErr() && result.error.code).toBe(
				"cli.singleConfigFlag"
			);
		}
	);

	it("should count -c paths towards the several names", () => {
		const result = refs({
			_: ["build", "lobby"],
			config: ["match.rogen.json"],
			"out-file": "a.json",
		});

		expect(result.isErr() && result.error.code).toBe(
			"cli.singleConfigFlag"
		);
	});

	it("should allow -o with one name", () => {
		expect(
			refs({ _: ["build", "lobby"], "out-file": "a.json" }).isOk()
		).toBe(true);
	});
});
