import { UsageError } from "../../../base/errors.js";
import { ResultError } from "../../../base/result.js";
import { buildableConfig } from "../config-service.js";
import {
	useConfigFixture,
	selection,
	write,
	start,
	resolved,
	errors,
} from "./config-fixture.js";

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("overrides", () => {
		it("should apply outFile against the working directory", async () => {
			await write("/repo/default.rogen.json", {
				outFile: "old.project.json",
			});

			await start({
				overrides: { outFile: "out/new.project.json", variants: {} },
			});

			expect(resolved(0)).toMatchObject({
				outFile: "/repo/out/new.project.json",
			});
		});

		it("should leave every declared variant off unless a flag turns it on", async () => {
			await write("/repo/default.rogen.json", {
				variants: ["mock", "dev", "prod"],
			});

			await start();

			expect(resolved(0)?.variants).toEqual({
				mock: false,
				dev: false,
				prod: false,
			});
		});

		it("should turn a declared variant on and leave the others", async () => {
			await write("/repo/default.rogen.json", {
				variants: ["mock", "dev", "prod"],
			});

			await start({ overrides: { variants: { mock: true } } });

			expect(resolved(0)?.variants).toEqual({
				mock: true,
				dev: false,
				prod: false,
			});
		});

		it("should fail when no named config declares the variant", async () => {
			await write("/repo/lobby.rogen.json", { variants: ["mock"] });
			await write("/repo/match.rogen.json", {});

			const result = await start({
				names: ["lobby", "match"],
				overrides: { variants: { ghost: true } },
			});

			expect((result as ResultError<Error>).error.message).toContain(
				'"ghost"'
			);
		});

		it("should fail when no named config declares the variant a flag turns off", async () => {
			await write("/repo/default.rogen.json", { variants: ["mock"] });

			const result = await start({
				overrides: { variants: { ghost: false } },
			});

			expect(result.isErr() && result.error).toBeInstanceOf(UsageError);
		});

		it("should suggest the declared variant a misspelled one is closest to", async () => {
			await write("/repo/default.rogen.json", { variants: ["mock"] });

			const result = await start({
				overrides: { variants: { mokc: true } },
			});

			expect((result as ResultError<Error>).error.message).toBe(
				'Variant "mokc" is not declared by any config being built. Did you mean "mock"?'
			);
		});

		it("should apply a variant where it is declared and say where it was skipped", async () => {
			await write("/repo/lobby.rogen.json", { variants: ["mock"] });
			await write("/repo/match.rogen.json", {});

			const result = await start({
				names: ["lobby", "match"],
				overrides: { variants: { mock: true } },
			});

			expect(result.isOk()).toBe(true);
			expect(
				selection.entries.map((c) => buildableConfig(c)?.variants)
			).toEqual([{ mock: true }, {}]);
			expect(
				selection.entries.map(
					(c) => buildableConfig(c)?.skippedVariants
				)
			).toEqual([[], ["mock"]]);
		});

		it("should keep the skipped variants of the last valid config when a reload breaks it", async () => {
			await write("/repo/lobby.rogen.json", { variants: ["mock"] });
			await write("/repo/match.rogen.json", {});
			await start({
				names: ["lobby", "match"],
				overrides: { variants: { mock: true } },
			});

			await write("/repo/match.rogen.json", "{ nope");
			await selection.reload(["/repo/match.rogen.json"]);

			expect(resolved(1)?.skippedVariants).toEqual(["mock"]);
		});

		it("should not fail on a variant when a named config could not be read", async () => {
			await write("/repo/lobby.rogen.json", "{ nope");

			const result = await start({
				names: ["lobby"],
				overrides: { variants: { mock: true } },
			});

			expect(result.isOk()).toBe(true);
		});

		it("should keep the overrides across a reload", async () => {
			await write("/repo/default.rogen.json", {
				rootDirs: ["a"],
				variants: ["mock"],
			});
			await start({
				overrides: {
					outFile: "out.project.json",
					variants: { mock: true },
				},
			});

			await write("/repo/default.rogen.json", {
				rootDirs: ["b"],
				variants: ["mock"],
			});
			await selection.reload(["/repo/default.rogen.json"]);

			expect(resolved(0)).toMatchObject({
				rootDirs: ["/repo/b"],
				outFile: "/repo/out.project.json",
				variants: { mock: true },
			});
		});
	});

	describe("modes", () => {
		const routes = { "*": "ReplicatedStorage/Shared" };

		it("should build in the mode the config names, with the variants it lists on and its exclude added to the config's", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["mock", "debug"],
				exclude: ["**/_*"],
				mode: "dev",
				modes: {
					dev: { variants: ["mock"] },
					prod: { exclude: ["**/*.spec.luau"] },
				},
			});

			await start();

			expect(resolved(0)).toMatchObject({
				mode: "dev",
				modes: ["dev", "prod"],
				variants: { mock: true, debug: false },
				exclude: ["/repo/**/_*"],
			});
		});

		it("should add the mode's exclude to the config's", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				exclude: ["**/_*"],
				mode: "prod",
				modes: { dev: {}, prod: { exclude: ["**/*.spec.luau"] } },
			});

			await start();

			expect(resolved(0)).toMatchObject({
				mode: "prod",
				exclude: ["/repo/**/_*", "/repo/**/*.spec.luau"],
			});
		});

		it("should build in the mode --mode names over the config's own", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: { exclude: ["Dev"] } },
			});

			await start({ overrides: { mode: "prod", variants: {} } });

			expect(resolved(0)).toMatchObject({
				mode: "prod",
				exclude: ["/repo/Dev"],
			});
		});

		it("should build in the mode --mode names when the config writes none", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				modes: { dev: {}, prod: {} },
			});

			await start({ overrides: { mode: "prod", variants: {} } });

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.mode).toBe("prod");
		});

		it("should require a mode when modes are declared and nothing names one", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage/Shared" },
	"modes": { "dev": {}, "prod": {} }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.modeRequired",
					resource: "/repo/default.rogen.json",
					position: { line: 3, column: 11 },
					message: expect.stringContaining(
						'Set "mode" to "dev" and "prod", or pass --mode.'
					),
				},
			]);
			expect(resolved(0)).toBeUndefined();
		});

		it("should take the mode from the config it extends", async () => {
			await write("/repo/base.rogen.json", {
				routes,
				mode: "prod",
				modes: { dev: {}, prod: {} },
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start({ names: ["default"] });

			expect(resolved(0)?.mode).toBe("prod");
		});

		it("should turn a variant on with a flag beyond the mode's", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["mock", "halloween"],
				mode: "dev",
				modes: { dev: { variants: ["mock"] } },
			});

			await start({ overrides: { variants: { halloween: true } } });

			expect(resolved(0)?.variants).toEqual({
				mock: true,
				halloween: true,
			});
		});

		it("should let --no-variant turn off a variant the mode lists", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["mock"],
				mode: "dev",
				modes: { dev: { variants: ["mock"] } },
			});

			await start({ overrides: { variants: { mock: false } } });

			expect(resolved(0)?.variants).toEqual({ mock: false });
		});

		it("should merge modes by name across extends, adding a child's globs and variants to the parent's", async () => {
			await write("/repo/base.rogen.json", {
				routes,
				variants: ["mock", "debug"],
				modes: {
					dev: { variants: ["mock"] },
					prod: { exclude: ["**/*.spec.luau"] },
				},
			});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
				mode: "prod",
				modes: {
					prod: { exclude: ["Tools"], variants: ["debug"] },
					staging: {},
				},
			});

			await start();

			expect(resolved(0)).toMatchObject({
				mode: "prod",
				modes: ["dev", "prod", "staging"],
				variants: { mock: false, debug: true },
				exclude: ["/repo/**/*.spec.luau", "/repo/Tools"],
			});
		});

		it("should ignore --mode in a config that declares no modes", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: {} },
			});
			await write("/repo/tools.rogen.json", { routes });

			const result = await start({
				names: ["default", "tools"],
				overrides: { mode: "prod", variants: {} },
			});

			expect(result.isOk()).toBe(true);
			expect(resolved(0)?.mode).toBe("prod");
			expect(resolved(1)?.mode).toBeUndefined();
		});

		it("should refuse --mode when no config being built declares modes", async () => {
			await write("/repo/default.rogen.json", { routes });

			const result = await start({
				overrides: { mode: "prod", variants: {} },
			});

			expect(result.isErr()).toBe(true);
			expect(result.isErr() && result.error).toBeInstanceOf(UsageError);
			expect(result.isErr() && result.error.message).toContain(
				'Mode "prod" is not declared by any config being built'
			);
		});

		it("should break a config that lacks the mode --mode names, so a run never builds it in another", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: {} },
			});
			await write("/repo/lobby.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prd: {} },
			});

			await start({
				names: ["default", "lobby"],
				overrides: { mode: "prod", variants: {} },
			});

			expect(resolved(0)?.mode).toBe("prod");
			expect(errors(1)).toMatchObject([
				{ code: "config.modeNotDeclared" },
			]);
			expect(errors(1)[0].message).toContain('Did you mean "prd"?');
		});

		it("should refuse a variant flag that names a mode", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: {} },
			});

			const result = await start({
				overrides: { variants: { prod: true } },
			});

			expect(result.isErr() && result.error).toBeInstanceOf(UsageError);
			expect(result.isErr() && result.error.message).toBe(
				'"prod" is a mode, not a variant. Pick it with --mode prod.'
			);
		});

		it("should report a mode field that names no declared mode where it is written", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage/Shared" },
	"mode": "prod",
	"modes": { "dev": {} }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.unknownMode",
					resource: "/repo/default.rogen.json",
					position: { line: 3, column: 10 },
				},
			]);
		});

		it("should report a mode field that names no declared mode even when --mode picks a valid one", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "prd",
				modes: { dev: {}, prod: {} },
			});

			await start({ overrides: { mode: "prod", variants: {} } });

			expect(errors(0)).toMatchObject([{ code: "config.unknownMode" }]);
			expect(errors(0)[0].message).toContain('Did you mean "prod"?');
		});

		it("should not read a mode named like an Object member as a clash", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "constructor",
				modes: { constructor: {}, toString: {} },
			});

			await start();

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.modes).toEqual(["constructor", "toString"]);
		});

		it("should report a mode field in a config that declares no modes", async () => {
			await write("/repo/default.rogen.json", { routes, mode: "prod" });

			await start();

			expect(errors(0)[0]).toMatchObject({ code: "config.unknownMode" });
			expect(errors(0)[0].message).toContain("declares no modes");
		});

		it("should reject a mode body with any field but variants and exclude", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "prod",
				modes: { prod: { rootDirs: ["src"] } },
			});

			await start();

			expect(errors(0)).toMatchObject([{ code: "config.unknownField" }]);
			expect(errors(0)[0].message).toContain("modes.prod.rootDirs");
		});

		it("should reject a mode named like a route or a variant", async () => {
			await write("/repo/default.rogen.json", {
				routes: { ...routes, Server: "ServerScriptService" },
				variants: ["mock"],
				mode: "Server",
				modes: { Server: {}, mock: {} },
			});

			await start();

			expect(errors(0).map(({ code }) => code)).toEqual([
				"config.modeClashesWithRoute",
				"config.modeClashesWithVariant",
			]);
		});

		it("should reject a mode name that is not a name", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "1st",
				modes: { "1st": {} },
			});

			await start();

			expect(errors(0)).toMatchObject([
				{ code: "config.invalidModeName" },
			]);
		});

		it("should reject two modes that differ only in their first letter", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "prod",
				modes: { prod: {}, Prod: {} },
			});

			await start();

			expect(errors(0)).toMatchObject([{ code: "config.ambiguousKey" }]);
		});

		it("should reject a mode that turns on a variant nothing declares, at the entry's own line", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage/Shared" },
	"mode": "dev",
	"modes": {
		"dev": { "variants": ["mock"] }
	}
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.undeclaredModeVariant",
					position: { line: 5, column: 25 },
					message: expect.stringContaining("Declare it there."),
				},
			]);
		});

		it("should suggest the declared variant a mode's entry is a typo of", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["mock"],
				mode: "dev",
				modes: { dev: { variants: ["mocks"] } },
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.undeclaredModeVariant",
					message: expect.stringContaining('Did you mean "mock"?'),
				},
			]);
		});

		it("should keep the chosen mode across a reload", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: { exclude: ["a"] } },
			});
			await start({ overrides: { mode: "prod", variants: {} } });

			await write("/repo/default.rogen.json", {
				routes,
				mode: "dev",
				modes: { dev: {}, prod: { exclude: ["b"] } },
			});
			await selection.reload(["/repo/default.rogen.json"]);

			expect(resolved(0)).toMatchObject({
				mode: "prod",
				exclude: ["/repo/b"],
			});
		});

		it("should give every declared mode its own view of the config, with only the variants it lists on", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["mock"],
				exclude: ["x"],
				mode: "prod",
				modes: {
					dev: { variants: ["mock"] },
					prod: { exclude: ["y"] },
				},
			});

			await start({ overrides: { variants: { mock: true } } });

			expect(resolved(0)?.variants).toEqual({ mock: true });
			const dev = resolved(0)?.inMode("dev");
			expect(dev).toMatchObject({
				mode: "dev",
				variants: { mock: true },
				exclude: ["/repo/x"],
			});
			const prod = resolved(0)?.inMode("prod");
			expect(prod).toMatchObject({
				mode: "prod",
				variants: { mock: false },
				exclude: ["/repo/x", "/repo/y"],
			});
			expect(resolved(0)?.inMode("nope")).toBeUndefined();
		});
	});

	describe("old variants map", () => {
		it("should say variants is a list now, and where modes take over", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"variants": { "mock": true }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.variantsAreAList",
					position: { line: 2, column: 14 },
					message: expect.stringContaining('["mock", "debug"]'),
				},
			]);
			expect(errors(0)[0].message).toContain("core-concepts/modes");
		});

		it("should say the same of a mode's variants", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"variants": ["mock"],
	"mode": "dev",
	"modes": { "dev": { "variants": { "mock": true } } }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{ code: "config.variantsAreAList" },
			]);
			expect(errors(0)[0].message).toContain('"modes.dev.variants"');
		});
	});

	describe("conflicts", () => {
		const routes = { "*": "ReplicatedStorage/Shared" };
		const base = {
			routes,
			variants: ["mock", "halloween", "christmas"],
			conflicts: [["halloween", "christmas"]],
		};

		it("should hold the groups on the resolved config", async () => {
			await write("/repo/default.rogen.json", base);

			await start();

			expect(resolved(0)?.conflicts).toEqual([
				["halloween", "christmas"],
			]);
		});

		it("should allow one variant of a group", async () => {
			await write("/repo/default.rogen.json", base);

			await start({ overrides: { variants: { halloween: true } } });

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.variants.halloween).toBe(true);
		});

		it("should refuse two variants of a group the command line turns on", async () => {
			await write("/repo/default.rogen.json", base);

			await start({
				overrides: { variants: { halloween: true, christmas: true } },
			});

			expect(errors(0)).toMatchObject([
				{
					code: "config.variantConflict",
					message: expect.stringContaining(
						'variants "halloween" and "christmas" conflict'
					),
				},
			]);
			expect(errors(0)[0].message).toContain("Pass only one of them.");
		});

		it("should refuse a variant the command line adds to one the mode turns on, and suggest turning the mode's off", async () => {
			await write("/repo/default.rogen.json", {
				...base,
				mode: "dev",
				modes: { dev: { variants: ["halloween"] } },
			});

			await start({ overrides: { variants: { christmas: true } } });

			expect(errors(0)).toMatchObject([
				{ code: "config.variantConflict" },
			]);
			expect(errors(0)[0].message).toContain(
				'halloween from mode "dev", christmas from --variant'
			);
			expect(errors(0)[0].message).toContain(
				"--no-variant halloween --variant christmas"
			);
		});

		it("should accept the swap the error suggests", async () => {
			await write("/repo/default.rogen.json", {
				...base,
				mode: "dev",
				modes: { dev: { variants: ["halloween"] } },
			});

			await start({
				overrides: { variants: { halloween: false, christmas: true } },
			});

			expect(errors(0)).toEqual([]);
			expect(resolved(0)?.variants).toEqual({
				mock: false,
				halloween: false,
				christmas: true,
			});
		});

		it("should refuse a mode that turns on two variants of a group, at the second", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage/Shared" },
	"variants": ["halloween", "christmas"],
	"conflicts": [["halloween", "christmas"]],
	"mode": "dev",
	"modes": { "dev": { "variants": ["halloween", "christmas"] } }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.modeConflict",
					position: { line: 6, column: 48 },
					message: expect.stringContaining(
						'mode "dev" turns on "halloween" and "christmas"'
					),
				},
			]);
		});

		it("should not repeat a conflict a mode alone causes when the command line adds another", async () => {
			await write("/repo/default.rogen.json", {
				...base,
				mode: "dev",
				modes: { dev: { variants: ["halloween", "christmas"] } },
			});

			await start({ overrides: { variants: { mock: true } } });

			expect(errors(0).map(({ code }) => code)).toEqual([
				"config.modeConflict",
			]);
		});

		it("should check every group a variant sits in", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["a", "b", "c"],
				conflicts: [
					["a", "b"],
					["b", "c"],
				],
			});

			await start({ overrides: { variants: { b: true, c: true } } });

			expect(errors(0)).toMatchObject([
				{ code: "config.variantConflict" },
			]);
			expect(errors(0)[0].message).toContain('"b" and "c"');
		});

		it("should refuse a group that names a mode", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"routes": { "*": "ReplicatedStorage/Shared" },
	"variants": ["mock"],
	"conflicts": [["mock", "prod"]],
	"mode": "prod",
	"modes": { "prod": {} }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.conflictNamesMode",
					position: { line: 4, column: 16 },
				},
			]);
		});

		it("should refuse a group that names an undeclared variant, and suggest the near miss", async () => {
			await write("/repo/default.rogen.json", {
				routes,
				variants: ["halloween", "christmas"],
				conflicts: [["halloween", "christmass"]],
			});

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.conflictUndeclaredVariant",
					message: expect.stringContaining(
						'Did you mean "christmas"?'
					),
				},
			]);
		});

		it("should add a place's group to the shared ones", async () => {
			await write("/repo/base.rogen.json", {
				routes,
				variants: ["a", "b", "c"],
				conflicts: [["a", "b"]],
			});
			await write("/repo/lobby.rogen.json", {
				extends: "./base.rogen.json",
				conflicts: [["b", "c"]],
			});

			await start({ names: ["lobby"] });

			expect(resolved(0)?.conflicts).toEqual([
				["a", "b"],
				["b", "c"],
			]);
		});
	});
});
