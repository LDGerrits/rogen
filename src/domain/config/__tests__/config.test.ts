import "../config.js";
import { Registry } from "../../../platform/registry/registry.js";
import {
	Extensions,
	ConfigRegistry,
} from "../../../platform/config/config-registry.js";
import { RogenConfig, ResolvedConfig } from "../config.js";

describe("domain/config/config contribution", () => {
	const registry = Registry.as<ConfigRegistry>(Extensions.Config);
	const schema = registry.getJsonSchema();

	const ROOT_FIELDS = [
		"$schema",
		"extends",
		"rootDirs",
		"routes",
		"tags",
		"exclude",
		"template",
		"syncDir",
		"outFile",
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
		"modes",
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

		it("defaults tags to {}", () => {
			expect(schema.properties!.tags.default).toEqual({});
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

	it("RogenConfig accepts an entirely absent config (compile-time check)", () => {
		const raw: RogenConfig = {};
		expect(raw).toEqual({});
	});

	it("ResolvedConfig requires no template/syncDir (compile-time check)", () => {
		const resolved: ResolvedConfig = {
			name: "repo",
			rootDirs: ["/repo/src"],
			routes: {},
			tags: {},
			exclude: [],
			outFile: "/repo/default.project.json",
		};
		expect(resolved.template).toBeUndefined();
		expect(resolved.syncDir).toBeUndefined();
	});
});
