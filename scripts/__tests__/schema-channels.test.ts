import { schemaChannels } from "../schema-channels.js";

describe("scripts/schema-channels", () => {
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

		it("should compare published versions numerically rather than as text", () => {
			expect(schemaChannels("2.9.0", ["2.10.0"])).toEqual(["2.9.0"]);
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
});
