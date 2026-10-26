import fs from "fs";
import path from "path";
import { configStructure, rojoKeys } from "../config-structure.js";
import { ROGEN_KEYS } from "../config.js";

describe("domain/config/config-structure", () => {
	describe("configStructure", () => {
		const ROJO_FIELDS = [
			"$schema",
			"name",
			"tree",
			"servePort",
			"servePlaceIds",
			"blockedPlaceIds",
			"placeId",
			"gameId",
			"serveAddress",
			"serveAllowedHosts",
			"emitLegacyScripts",
			"globIgnorePaths",
			"syncRules",
			"syncbackRules",
		];

		it("types Rojo's keys and Rogen's beside them", () => {
			expect(Object.keys(configStructure.properties!).sort()).toEqual(
				[...ROJO_FIELDS, ...ROGEN_KEYS].sort()
			);
			expect([...rojoKeys].sort()).toEqual([...ROJO_FIELDS].sort());
		});

		it.each(["help/config.md", "docs/content/docs/v2/config.mdx"])(
			"has every Rogen key named in %s",
			(file) => {
				const text = fs.readFileSync(
					path.resolve(import.meta.dirname, "../../../..", file),
					"utf8"
				);

				expect(
					ROGEN_KEYS.filter((key) => !text.includes(`\`${key}\``))
				).toEqual([]);
			}
		);

		it("lets a key outside both lists pass for the loader to warn about", () => {
			expect(configStructure.additionalProperties).toBeUndefined();
		});

		it.each([
			"source",
			"aliases",
			"extends",
			"template",
			"outFile",
			"projects",
			"serveProject",
			"rogen",
		])("does not type the unsupported key %s", (key) => {
			expect(configStructure.properties![key]).toBeUndefined();
		});
	});
});
