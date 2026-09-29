import path from "path";
import { ConfigEntry } from "../../../domain/config/config-service.js";
import { describeConfig } from "../describe-config.js";

const cwd = path.resolve("/repo");

const entryOf = (overrides: Partial<ConfigEntry> = {}): ConfigEntry => ({
	file: path.join(cwd, "match.rogen.json"),
	chain: [path.join(cwd, "match.rogen.json")],
	resolved: undefined,
	diagnostics: [],
	skippedTags: [],
	...overrides,
});

describe("describeConfig", () => {
	it("should say nothing about a config with no parent and no skipped tags", () => {
		expect(describeConfig(entryOf(), cwd)).toEqual([]);
	});

	it("should name the extends chain relative to the working directory", () => {
		expect(
			describeConfig(
				entryOf({
					chain: [
						path.join(cwd, "match.rogen.json"),
						path.join(cwd, "default.rogen.json"),
						path.join(cwd, "shared/base.rogen.json"),
					],
				}),
				cwd
			)
		).toEqual(["extends: default.rogen.json -> shared/base.rogen.json"]);
	});

	it("should name each tag flag the config does not declare", () => {
		expect(
			describeConfig(entryOf({ skippedTags: ["mock", "debug"] }), cwd)
		).toEqual([
			"tag mock skipped: not declared in this config",
			"tag debug skipped: not declared in this config",
		]);
	});
});
