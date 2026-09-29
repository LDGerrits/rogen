import fs from "fs";
import { SCHEMA_URL } from "../../init/init-files.js";
import {
	compareVersions,
	isPrerelease,
	schemaChannels,
	schemaUrlFor,
} from "../schema-url.js";

describe("schema-url", () => {
	describe("isPrerelease", () => {
		it("should detect a pre-release version", () => {
			expect(isPrerelease("2.0.0-beta.1")).toBe(true);
			expect(isPrerelease("2.0.0-rc.2")).toBe(true);
		});

		it("should treat a plain version as stable", () => {
			expect(isPrerelease("2.0.0")).toBe(false);
			expect(isPrerelease("2.1.3")).toBe(false);
		});
	});

	describe("schemaChannels", () => {
		it("should publish a stable release under its version, its major and latest", () => {
			expect(schemaChannels("2.1.0")).toEqual(["2.1.0", "2", "latest"]);
		});

		it("should publish a pre-release only under its exact version", () => {
			expect(schemaChannels("2.0.0-beta.1")).toEqual(["2.0.0-beta.1"]);
		});

		it("should publish every channel when nothing newer is published", () => {
			expect(schemaChannels("2.1.0", ["2.0.0", "2.0.1"])).toEqual([
				"2.1.0",
				"2",
				"latest",
			]);
		});

		it("should not move the major or latest back for an older patch", () => {
			expect(schemaChannels("2.0.5", ["2.0.0", "2.1.0"])).toEqual([
				"2.0.5",
			]);
		});

		it("should still move the major for a patch to an older major", () => {
			expect(schemaChannels("2.0.5", ["2.0.0", "3.0.0"])).toEqual([
				"2.0.5",
				"2",
			]);
		});

		it("should ignore published pre-releases", () => {
			expect(schemaChannels("2.0.0", ["2.1.0-beta.1"])).toEqual([
				"2.0.0",
				"2",
				"latest",
			]);
		});

		it("should republish the same version's channels", () => {
			expect(schemaChannels("2.1.0", ["2.1.0"])).toEqual([
				"2.1.0",
				"2",
				"latest",
			]);
		});
	});

	describe("compareVersions", () => {
		it("should compare numerically rather than as text", () => {
			expect(compareVersions("2.10.0", "2.9.0")).toBeGreaterThan(0);
			expect(compareVersions("2.0.0", "10.0.0")).toBeLessThan(0);
			expect(compareVersions("2.1.0", "2.1.0")).toBe(0);
		});
	});

	describe("schemaUrlFor", () => {
		it("should point a stable release at its major", () => {
			expect(schemaUrlFor("2.1.0")).toBe(
				"https://ldgerrits.github.io/rogen/schema/2/rogen.json"
			);
		});

		it("should point a pre-release at its exact version", () => {
			expect(schemaUrlFor("2.0.0-beta.1")).toBe(
				"https://ldgerrits.github.io/rogen/schema/2.0.0-beta.1/rogen.json"
			);
		});

		it("should match the URL init writes for the package version", () => {
			const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
				version: string;
			};
			expect(SCHEMA_URL).toBe(schemaUrlFor(pkg.version));
		});
	});
});
