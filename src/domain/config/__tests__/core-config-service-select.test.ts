import { jest } from "@jest/globals";
import { UsageError } from "../../../base/errors.js";
import { ResultError } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { buildableConfig } from "../config-service.js";
import {
	Refs,
	useConfigFixture,
	fs,
	service,
	selection,
	write,
	plain,
	start,
	resolved,
	errors,
} from "./config-fixture.js";

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("select", () => {
		it("should select every config here when none is named, sorted", async () => {
			await write("/repo/match.rogen.json", {});
			await write("/repo/lobby.rogen.json", {});
			await fs.writeFile("/repo/README.md", "");
			await fs.createDirectory("/repo/dir.rogen.json");
			await write("/repo/nested/other.rogen.json", {});

			const selection = (await start({ names: [] })).unwrap();

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/lobby.rogen.json",
				"/repo/match.rogen.json",
			]);
		});

		it("should select only the configs named, by name or path", async () => {
			await write("/repo/default.rogen.json", {});
			await write("/repo/places/lobby.rogen.json", {});

			const selection = (
				await start({ names: ["places/lobby.rogen.json"] })
			).unwrap();

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/places/lobby.rogen.json",
			]);
		});

		const refusal = async (refs: Refs) => {
			await write("/repo/lobby.rogen.json", {});
			await write("/repo/match.rogen.json", {});
			const result = await start(refs);
			return result.isErr() ? result.error : undefined;
		};

		it("should refuse -o with several named configs", async () => {
			const error = await refusal({
				names: ["lobby", "match.rogen.json"],
				overrides: { outFile: "a.json", variants: {} },
			});

			expect(error).toBeInstanceOf(UsageError);
			expect(error?.message).toBe(
				"-o targets a single config, but 2 configs were named. Name one config, or set outFile in the file."
			);
		});

		it("should refuse -o when none is named and several are here", async () => {
			const error = await refusal({
				names: [],
				overrides: { outFile: "a.json", variants: {} },
			});

			expect(error?.message).toBe(
				"-o targets a single config, but 2 configs are here. Name one config, or set outFile in the file."
			);
		});

		it("should allow -o with one config", async () => {
			await write("/repo/lobby.rogen.json", {});

			const result = await start({
				names: ["lobby"],
				overrides: { outFile: "a.json", variants: {} },
			});

			expect(result.isOk()).toBe(true);
		});

		it("should allow -o when none is named and one is here", async () => {
			await write("/repo/lobby.rogen.json", {});

			const result = await start({
				names: [],
				overrides: { outFile: "a.json", variants: {} },
			});

			expect(result.isOk()).toBe(true);
		});

		it("should resolve the default config with defaults applied", async () => {
			await write("/repo/default.rogen.json", {});

			expect((await start()).isOk()).toBe(true);

			const [entry] = selection.entries;
			expect(entry.file).toBe("/repo/default.rogen.json");
			expect(entry.status).toBe("valid");
			expect(plain(resolved(0))).toMatchObject({
				rootDirs: ["/repo/src"],
				routes: {},
				variants: {},
				exclude: [],
				outFile: "/repo/default.project.json",
			});
		});

		it("should resolve several named configs in one service", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await write("/repo/source.rogen.json", { rootDirs: ["b"] });

			await start({ names: ["default", "source"] });

			expect(
				selection.entries.map((c) => buildableConfig(c)?.rootDirs)
			).toEqual([["/repo/a"], ["/repo/b"]]);
		});

		it("should fail when discovery fails", async () => {
			const result = await start({ names: ["nope"] });

			expect((result as ResultError<Error>).error.message).toContain(
				'Config "nope" not found'
			);
		});

		it("should put a broken config's errors on its own entry only", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await write("/repo/prod.rogen.json", { bogus: true });

			await start({ names: ["default", "prod"] });

			expect(selection.entries.map(({ status }) => status)).toEqual([
				"valid",
				"broken",
			]);
			expect(errors(1)).toMatchObject([
				{
					code: "config.unknownField",
					resource: "/repo/prod.rogen.json",
					position: { line: 1, column: 2 },
				},
			]);
		});

		it("should leave resolved undefined for a config that was never valid", async () => {
			await write("/repo/default.rogen.json", "{ nope");

			await start();

			expect(resolved(0)).toBeUndefined();
		});

		it("should select two configs writing the same outFile", async () => {
			await write("/repo/a.rogen.json", { outFile: "same.project.json" });
			await write("/repo/b.rogen.json", { outFile: "same.project.json" });

			const result = await start({ names: ["a", "b"] });

			expect(result.isOk()).toBe(true);
			expect(selection.entries.map((_, index) => errors(index))).toEqual([
				[],
				[],
			]);
		});

		it("should list every file of every chain", async () => {
			await write("/repo/base.rogen.json", {});
			await write("/repo/default.rogen.json", {
				extends: "./base.rogen.json",
			});

			await start();

			expect(selection.files).toEqual(
				new Set(["/repo/default.rogen.json", "/repo/base.rogen.json"])
			);
		});
	});

	describe("selection", () => {
		it("should return every config when all are valid", async () => {
			await write("/repo/a.rogen.json", { rootDirs: ["a"] });
			await write("/repo/b.rogen.json", { rootDirs: ["b"] });
			await start({ names: ["a", "b"] });

			expect(
				selection
					.requireValid()
					.unwrap()
					.map(({ rootDirs }) => rootDirs)
			).toEqual([["/repo/a"], ["/repo/b"]]);
		});

		it("should fail with the errors of every broken config", async () => {
			await write("/repo/a.rogen.json", {});
			await write("/repo/b.rogen.json", { bogus: 1 });
			await write("/repo/c.rogen.json", "{ nope");
			await start({ names: ["a", "b", "c"] });

			const result = selection.requireValid();

			expect(
				(result as ResultError<DiagnosticsError>).error.diagnostics
			).toEqual([...errors(1), ...errors(2)]);
		});

		it("should fail for a config that is broken now but has a last valid version", async () => {
			await write("/repo/default.rogen.json", {});
			await start();
			await write("/repo/default.rogen.json", { bogus: 1 });
			await selection.reload(["/repo/default.rogen.json"]);

			expect(selection.requireValid().isErr()).toBe(true);
		});
	});

	describe("read", () => {
		it("should resolve a config file without adding it to the configs", async () => {
			await write("/repo/other.rogen.json", { rootDirs: ["lib"] });

			const entry = await service.read("/repo/other.rogen.json");

			expect(buildableConfig(entry)?.rootDirs).toEqual(["/repo/lib"]);
			expect(entry.status).toBe("valid");
		});

		it("should follow the extends chain", async () => {
			await write("/repo/base.rogen.json", { syncDir: "out" });
			await write("/repo/other.rogen.json", {
				extends: "./base.rogen.json",
			});

			const entry = await service.read("/repo/other.rogen.json");

			expect(entry.parents).toEqual(["/repo/base.rogen.json"]);
			expect(buildableConfig(entry)?.syncDir).toBe("/repo/out");
		});

		it("should put the problems of a broken config on the entry", async () => {
			await write("/repo/other.rogen.json", "{ nope");

			const entry = await service.read("/repo/other.rogen.json");

			expect(entry).toMatchObject({
				status: "broken",
				lastValid: undefined,
			});
		});
	});

	describe("unnamed config", () => {
		it("should fail a config file with no name before .rogen.json", async () => {
			await write("/repo/.rogen.json", { rootDirs: ["src"] });

			const entry = await service.read("/repo/.rogen.json");

			expect(entry).toMatchObject({
				status: "broken",
				errors: [
					{
						code: "config.unnamed",
						resource: "/repo/.rogen.json",
						message: expect.stringContaining(
							"Rename it to <name>.rogen.json"
						),
					},
				],
			});
		});
	});

	describe("registerFileCheck", () => {
		const hint = (file: string) => ({
			severity: DiagnosticSeverity.Warning,
			code: "test.hint",
			resource: file,
			message: "a hint",
		});

		it("should add a check's hints to the errors of a file that fails to load", async () => {
			await write("/repo/a.rogen.json", { nope: true });
			service.registerFileCheck(({ file }) => [hint(file)]);

			const entry = await service.read("/repo/a.rogen.json");

			expect(
				entry.status === "broken" &&
					entry.errors.map(({ code }) => code)
			).toEqual(["config.unknownField", "test.hint"]);
		});

		it("should hand the check what the file holds, or nothing when it doesn't parse", async () => {
			await write("/repo/a.rogen.json", { nope: true });
			await write("/repo/b.rogen.json", "{ nope");
			const seen: unknown[] = [];
			service.registerFileCheck(({ value }) => {
				seen.push(value);
				return [];
			});

			await service.read("/repo/a.rogen.json");
			await service.read("/repo/b.rogen.json");

			expect(seen).toEqual([{ nope: true }, undefined]);
		});

		it("should never run on a config that loads", async () => {
			await write("/repo/a.rogen.json", { rootDirs: ["src"] });
			const check = jest.fn(() => []);
			service.registerFileCheck(check);

			const entry = await service.read("/repo/a.rogen.json");

			expect(entry.status).toBe("valid");
			expect(check).not.toHaveBeenCalled();
		});

		it("should run on an unnamed config", async () => {
			await write("/repo/.rogen.json", { source: ["src"] });
			service.registerFileCheck(({ file }) => [hint(file)]);

			const entry = await service.read("/repo/.rogen.json");

			expect(
				entry.status === "broken" &&
					entry.errors.map(({ code }) => code)
			).toEqual(["config.unnamed", "test.hint"]);
		});

		it("should stop running once the registration is disposed", async () => {
			await write("/repo/a.rogen.json", { nope: true });
			const check = jest.fn(() => []);
			const registration = service.registerFileCheck(check);

			registration[Symbol.dispose]();
			await service.read("/repo/a.rogen.json");

			expect(check).not.toHaveBeenCalled();
		});
	});
});
