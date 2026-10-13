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

	describe("removed fields", () => {
		it("should say modes was removed, where it is written", async () => {
			await write(
				"/repo/default.rogen.json",
				`{
	"modes": { "dev": {} }
}`
			);

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.removedField",
					position: { line: 2, column: 2 },
					message: expect.stringContaining('"modes" was removed.'),
				},
			]);
		});

		it("should say mode was removed", async () => {
			await write("/repo/default.rogen.json", { mode: "dev" });

			await start();

			expect(errors(0)).toMatchObject([
				{
					code: "config.removedField",
					message: expect.stringContaining('"mode" was removed.'),
				},
			]);
		});
	});

	describe("old variants map", () => {
		it("should say variants is a list now", async () => {
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
			expect(errors(0)[0].message).toContain("core-concepts/variants");
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
