import fs from "fs";
import path from "path";
import "../config.js";
import { Registry } from "../../../platform/registry/registry.js";
import {
	Extensions,
	ConfigRegistry,
} from "../../../platform/config/config-registry.js";
import { SCHEMA_URL } from "../../init/init-files.js";
import {
	RogenConfig,
	ResolvedConfig,
	configFileName,
	configLabel,
	outerRootDir,
	schemaChannels,
	schemaUrlFor,
} from "../config.js";

describe("domain/config/config", () => {
	describe("contribution", () => {
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
				file: "/repo/default.rogen.json",
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

	describe("configFileName and configLabel", () => {
		it("should add the suffix to a stem", () => {
			expect(configFileName("lobby")).toBe("lobby.rogen.json");
		});

		it("should take the stem back out of a config path", () => {
			expect(configLabel("/repo/lobby.rogen.json")).toBe("lobby");
		});
	});

	describe("outerRootDir", () => {
		const abs = (...segments: string[]) =>
			path.resolve("/repo", ...segments);

		it("should find the root dir another one sits inside", () => {
			expect(
				outerRootDir(abs("src/lobby"), [abs("src"), abs("src/lobby")])
			).toBe(abs("src"));
		});

		it("should be undefined for siblings", () => {
			expect(
				outerRootDir(abs("core"), [abs("core"), abs("lobby")])
			).toBeUndefined();
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
