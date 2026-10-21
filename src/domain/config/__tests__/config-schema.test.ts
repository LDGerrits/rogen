import fs from "fs";
import path from "path";
import { JSONSchema } from "../../../base/json-schema.js";

import { SUPPORTED_SERVICES } from "../../roblox/supported-services.js";
import {
	configRemovedFieldAdvice,
	configSchema,
	rogenKeys,
	rojoKeys,
} from "../config-schema.js";

describe("domain/config/config-schema", () => {
	describe("configSchema", () => {
		const schema = configSchema;

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
		const ROGEN_FIELDS = [
			"sourcePaths",
			"routes",
			"syncPath",
			"placePaths",
		];

		describe("schema shape", () => {
			it("declares Rojo's keys and Rogen's", () => {
				expect(Object.keys(schema.properties!).sort()).toEqual(
					[...ROJO_FIELDS, ...ROGEN_FIELDS].sort()
				);
				expect([...rojoKeys].sort()).toEqual([...ROJO_FIELDS].sort());
				expect([...rogenKeys].sort()).toEqual([...ROGEN_FIELDS].sort());
			});

			it.each([
				"help/config.md",
				"docs/content/docs/v2/configuration.mdx",
			])("has every Rogen field named in %s", (file) => {
				const text = fs.readFileSync(
					path.resolve(import.meta.dirname, "../../../..", file),
					"utf8"
				);

				expect(
					ROGEN_FIELDS.filter(
						(field) => !text.includes(`\`${field}\``)
					)
				).toEqual([]);
			});

			it("lets a key outside both lists pass for the loader to warn about", () => {
				expect(schema.additionalProperties).toBeUndefined();
			});

			it.each([
				"source",
				"aliases",
				"extends",
				"template",
				"outFile",
				"projects",
				"serveProject",
			])("does not declare the unsupported field %s", (field) => {
				expect(schema.properties![field]).toBeUndefined();
			});
		});

		describe("defaults", () => {
			it('defaults sourcePaths to ["src"]', () => {
				expect(schema.properties!.sourcePaths.default).toEqual(["src"]);
			});

			it("defaults routes to {}", () => {
				expect(schema.properties!.routes.default).toEqual({});
			});

			it("has no static default for syncPath or the tree", () => {
				expect(schema.properties!.syncPath.default).toBeUndefined();
				expect(schema.properties!.tree.default).toBeUndefined();
			});
		});

		it("carries a description on every Rogen field", () => {
			for (const field of ROGEN_FIELDS) {
				expect(schema.properties![field].description).toBeTruthy();
			}
		});
	});

	describe("name rules", () => {
		const matches = (pattern: string | undefined, text: string) =>
			new RegExp(pattern ?? "").test(text);

		const routeKeys = configSchema.properties!.routes.propertyNames;
		const target = configSchema.properties!.routes
			.additionalProperties as JSONSchema;

		it.each(["server", "Server", "Shared2", "*"])(
			"accepts the route key %s",
			(key) => {
				expect(matches(routeKeys?.pattern, key)).toBe(true);
			}
		);

		it.each(["ser-ver", "2fast", "a.b", "", "**", "a b"])(
			"rejects the route key %p",
			(key) => {
				expect(matches(routeKeys?.pattern, key)).toBe(false);
			}
		);

		it.each(SUPPORTED_SERVICES)(
			"accepts the target service %s",
			(service) => {
				expect(matches(target.pattern, service)).toBe(true);
				expect(matches(target.pattern, `${service}/Shared/Deep`)).toBe(
					true
				);
			}
		);

		it.each([
			"StarterPlayerScripts",
			"ser-ver",
			"",
			"ReplicatedStorage/",
			"ReplicatedStorageShared",
			"/ReplicatedStorage",
		])("rejects the target %p", (text) => {
			expect(matches(target.pattern, text)).toBe(false);
		});

		it("offers the common targets, each of which the pattern accepts", () => {
			expect(target.examples).toEqual(
				expect.arrayContaining([
					"ServerScriptService",
					"StarterPlayer/StarterPlayerScripts",
					"ReplicatedStorage/Shared",
					"ReplicatedFirst",
					"ServerStorage",
					"StarterGui",
				])
			);
			for (const example of target.examples as string[])
				expect(matches(target.pattern, example)).toBe(true);
		});
	});

	describe("removed field advice", () => {
		const location = { resource: "/repo/rogen.json" };

		it.each([
			"modes",
			"mode",
			"variants",
			"conflicts",
			"server",
			"extends",
			"template",
			"outFile",
			"exclude",
			"rootDirs",
			"syncDir",
		])("says %s was removed and what to do instead", (field) => {
			expect(configRemovedFieldAdvice(field, location)).toMatchObject({
				code: "config.removedField",
				message: expect.stringContaining(`"${field}" was removed.`),
			});
		});

		it("names the replacement of exclude, and what it does to a mount", () => {
			expect(
				configRemovedFieldAdvice("exclude", location)?.message
			).toContain('"globIgnorePaths"');
			expect(
				configRemovedFieldAdvice("exclude", location)?.message
			).toContain("leaves out a mount");
		});

		it("leaves any other field to the unknown field warning", () => {
			expect(
				configRemovedFieldAdvice("exlude", location)
			).toBeUndefined();
			expect(
				configRemovedFieldAdvice("toString", location)
			).toBeUndefined();
		});
	});
});
