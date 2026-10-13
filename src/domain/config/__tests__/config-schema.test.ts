import fs from "fs";
import path from "path";
import { JSONSchema } from "../../../base/json-schema.js";
import { JsoncNode } from "../../../base/jsonc.js";
import { SUPPORTED_SERVICES } from "../../roblox/supported-services.js";
import {
	configDefaults,
	configMergePolicies,
	configRemovedFieldAdvice,
	configSchema,
	configWrongTypeAdvice,
} from "../config-schema.js";

describe("domain/config/config-schema", () => {
	describe("configSchema", () => {
		const schema = configSchema;

		const ROOT_FIELDS = [
			"$schema",
			"extends",
			"rootDirs",
			"routes",
			"variants",
			"conflicts",
			"exclude",
			"template",
			"syncDir",
			"outFile",
			"server",
		];

		const UNSUPPORTED_FIELDS = [
			"source",
			"verbatim",
			"unwrap",
			"casing",
			"aliases",
			"globIgnorePaths",
			"luau",
			"ts",
			"darklua",
			"profiles",
			"outputs",
			"sourceProject",
		];

		describe("schema shape", () => {
			it("declares exactly the root config fields", () => {
				expect(Object.keys(schema.properties!).sort()).toEqual(
					[...ROOT_FIELDS].sort()
				);
			});

			it.each([
				"help/config.md",
				"docs/content/docs/v2/configuration.mdx",
			])("has every root field named in %s", (file) => {
				const text = fs.readFileSync(
					path.resolve(import.meta.dirname, "../../../..", file),
					"utf8"
				);

				expect(
					Object.keys(schema.properties!).filter(
						(field) => !text.includes(`\`${field}\``)
					)
				).toEqual([]);
			});

			it("rejects unknown top-level keys", () => {
				expect(schema.additionalProperties).toBe(false);
			});

			it.each(UNSUPPORTED_FIELDS)(
				"does not declare the unsupported field %s",
				(field) => {
					expect(schema.properties![field]).toBeUndefined();
				}
			);
		});

		describe("defaults", () => {
			it('defaults rootDirs to ["src"]', () => {
				expect(schema.properties!.rootDirs.default).toEqual(["src"]);
			});

			it("defaults routes to {}", () => {
				expect(schema.properties!.routes.default).toEqual({});
			});

			it("defaults variants and conflicts to []", () => {
				expect(schema.properties!.variants.default).toEqual([]);
				expect(schema.properties!.conflicts.default).toEqual([]);
			});

			it("defaults exclude to []", () => {
				expect(schema.properties!.exclude.default).toEqual([]);
			});

			it("has no static default for template, syncDir or outFile", () => {
				expect(schema.properties!.template.default).toBeUndefined();
				expect(schema.properties!.syncDir.default).toBeUndefined();
				expect(schema.properties!.outFile.default).toBeUndefined();
			});
		});

		it("carries a description on every field", () => {
			for (const field of ROOT_FIELDS) {
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

		it("holds variant names to letters and digits", () => {
			const pattern = configSchema.properties!.variants.items?.pattern;

			expect(matches(pattern, "myVariant2")).toBe(true);
			expect(matches(pattern, "my-variant")).toBe(false);
			expect(matches(pattern, "2variant")).toBe(false);
			expect(matches(pattern, "")).toBe(false);
		});
	});

	describe("variants", () => {
		it("are a list of names", () => {
			expect(configSchema.properties!.variants).toMatchObject({
				type: "array",
				items: { type: "string" },
			});
		});
	});

	describe("conflicts", () => {
		it("are a list of groups of names", () => {
			expect(configSchema.properties!.conflicts).toMatchObject({
				type: "array",
				items: { type: "array", items: { type: "string" } },
			});
		});
	});

	describe("wrong type advice", () => {
		const object = { kind: "object" } as JsoncNode;
		const location = { resource: "/repo/default.rogen.json" };

		it("says variants is a list when a config writes the old map", () => {
			expect(
				configWrongTypeAdvice("variants", object, location)
			).toMatchObject({
				code: "config.variantsAreAList",
				message: expect.stringContaining('"variants" is a list'),
			});
		});

		it("leaves any other wrong value to the generic message", () => {
			expect(
				configWrongTypeAdvice("routes", object, location)
			).toBeUndefined();
			expect(
				configWrongTypeAdvice(
					"variants",
					{ kind: "string" } as JsoncNode,
					location
				)
			).toBeUndefined();
		});
	});

	describe("removed field advice", () => {
		const location = { resource: "/repo/default.rogen.json" };

		it.each(["modes", "mode"])(
			"says %s was removed and what to do instead",
			(field) => {
				expect(configRemovedFieldAdvice(field, location)).toMatchObject(
					{
						code: "config.removedField",
						message: expect.stringContaining(
							`"${field}" was removed.`
						),
					}
				);
			}
		);

		it("leaves any other field to the unknown field message", () => {
			expect(
				configRemovedFieldAdvice("exlude", location)
			).toBeUndefined();
			expect(
				configRemovedFieldAdvice("toString", location)
			).toBeUndefined();
		});
	});

	describe("configMergePolicies", () => {
		it("names a policy for every field", () => {
			expect(Object.keys(configMergePolicies).sort()).toEqual(
				Object.keys(configSchema.properties!).sort()
			);
		});

		it("adds list entries, merges maps and replaces strings", () => {
			expect(configMergePolicies).toMatchObject({
				rootDirs: "append",
				exclude: "append",
				routes: "merge",
				variants: "append",
				conflicts: "append",
				template: "replace",
				syncDir: "replace",
			});
		});
	});

	describe("configDefaults", () => {
		it("holds exactly the fields the schema gives a default", () => {
			expect(configDefaults.contents).toEqual({
				rootDirs: ["src"],
				routes: {},
				variants: [],
				conflicts: [],
				exclude: [],
			});
		});
	});
});
