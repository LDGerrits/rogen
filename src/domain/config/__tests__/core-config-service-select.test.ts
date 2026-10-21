import { jest } from "@jest/globals";
import { ResultError } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { DiagnosticSeverity } from "../../../platform/diagnostics/diagnostic.js";
import { buildableConfig } from "../config-service.js";
import {
	useConfigFixture,
	service,
	selection,
	write,
	plain,
	start,
	resolved,
	errors,
} from "./config-fixture.js";

const ROUTED = { server: "ServerScriptService" };

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("select", () => {
		it("should select the config here when none is named", async () => {
			await write("/repo/default.rogen.json", {});

			expect((await start()).isOk()).toBe(true);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.rogen.json",
			]);
			expect(selection.home).toBe("/repo");
		});

		it("should read a Rojo project file as the config when no default.rogen.json is above, and follow no folder", async () => {
			await write("/repo/default.project.json", {
				name: "plain",
				tree: { $className: "DataModel" },
			});

			expect((await start()).isOk()).toBe(true);

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/default.project.json",
			]);
			expect(selection.followedFolder).toBeUndefined();
			expect(buildableConfig(selection.entries[0])?.isAdopted).toBe(true);
		});

		it("should read a named Rojo project file as a config that is its own output", async () => {
			await write("/repo/test.project.json", {
				name: "plain",
				tree: { $className: "DataModel" },
			});

			expect((await start({ names: ["test.project.json"] })).isOk()).toBe(
				true
			);

			const config = buildableConfig(selection.entries[0]);
			expect(config?.isAdopted).toBe(true);
			expect(config?.projectFile).toBe("/repo/test.project.json");
			expect(selection.configs).toHaveLength(1);
		});

		it("should refuse a named Rojo project file without a name, which Rojo can't read", async () => {
			await write("/repo/test.project.json", {
				tree: { $className: "DataModel" },
			});

			await start({ names: ["test.project.json"] });

			const [entry] = selection.entries;
			expect(entry.status).toBe("broken");
			expect(
				entry.status === "broken" &&
					entry.errors.map(({ code }) => code)
			).toEqual(["config.unnamedProjectFile"]);
		});

		it("should select the config of each folder named", async () => {
			await write("/repo/places/lobby/default.rogen.json", {});
			await write("/repo/places/arena/default.rogen.jsonc", {});

			await start({ names: ["places/lobby", "places/arena"] });

			expect(selection.entries.map(({ file }) => file)).toEqual([
				"/repo/places/lobby/default.rogen.json",
				"/repo/places/arena/default.rogen.jsonc",
			]);
		});

		it("should resolve the config with its defaults", async () => {
			await write("/repo/default.rogen.json", {});

			expect((await start()).isOk()).toBe(true);

			const [entry] = selection.entries;
			expect(entry.status).toBe("valid");
			expect(plain(resolved(0))).toMatchObject({
				sourcePaths: [],
				routes: {},
				ignored: [],
				projectFile: "/repo/default.project.json",
			});
		});

		it("should resolve several configs in one service", async () => {
			await write("/repo/a/default.rogen.json", {
				routes: ROUTED,
				sourcePaths: ["x"],
			});
			await write("/repo/b/default.rogen.json", {
				routes: ROUTED,
				sourcePaths: ["y"],
			});

			await start({ names: ["a", "b"] });

			expect(
				selection.entries.map((c) => buildableConfig(c)?.sourcePaths)
			).toEqual([["/repo/a/x"], ["/repo/b/y"]]);
		});

		it("should fail when discovery fails", async () => {
			const result = await start({ names: ["nope"] });

			expect((result as ResultError<Error>).error.message).toContain(
				'"nope" not found'
			);
		});

		it("should put a broken config's errors on its own entry only", async () => {
			await write("/repo/a/default.rogen.json", {});
			await write("/repo/b/default.rogen.json", { modes: {} });

			await start({ names: ["a", "b"] });

			expect(selection.entries.map(({ status }) => status)).toEqual([
				"valid",
				"broken",
			]);
			expect(errors(1)).toMatchObject([
				{
					code: "config.removedField",
					resource: "/repo/b/default.rogen.json",
					position: { line: 1, column: 2 },
				},
			]);
		});

		it("should leave resolved undefined for a config that was never valid", async () => {
			await write("/repo/default.rogen.json", "{ nope");

			await start();

			expect(resolved(0)).toBeUndefined();
		});

		it("should list the file of every config", async () => {
			await write("/repo/a/default.rogen.json", {});
			await write("/repo/b/default.rogen.json", {});

			await start({ names: ["a", "b"] });

			expect(selection.files).toEqual(
				new Set([
					"/repo/a/default.rogen.json",
					"/repo/b/default.rogen.json",
				])
			);
		});
	});

	describe("selection", () => {
		it("should return every config when all are valid", async () => {
			await write("/repo/a/default.rogen.json", {
				routes: ROUTED,
				sourcePaths: ["x"],
			});
			await write("/repo/b/default.rogen.json", {
				routes: ROUTED,
				sourcePaths: ["y"],
			});
			await start({ names: ["a", "b"] });

			expect(
				selection
					.requireValid()
					.unwrap()
					.map(({ sourcePaths }) => sourcePaths)
			).toEqual([["/repo/a/x"], ["/repo/b/y"]]);
		});

		it("should fail with the errors of every broken config", async () => {
			await write("/repo/a/default.rogen.json", {});
			await write("/repo/b/default.rogen.json", { modes: {} });
			await write("/repo/c/default.rogen.json", "{ nope");
			await start({ names: ["a", "b", "c"] });

			const result = selection.requireValid();

			expect(
				(result as ResultError<DiagnosticsError>).error.diagnostics
			).toEqual([...errors(1), ...errors(2)]);
		});

		it("should fail for a config that is broken now but has a last valid version", async () => {
			await write("/repo/default.rogen.json", {});
			await start();
			await write("/repo/default.rogen.json", { modes: {} });
			await selection.reload(["/repo/default.rogen.json"]);

			expect(selection.requireValid().isErr()).toBe(true);
		});
	});

	describe("read", () => {
		it("should resolve a config file without adding it to the configs", async () => {
			await write("/repo/other/default.rogen.json", {
				routes: ROUTED,
				sourcePaths: ["lib"],
			});

			const entry = await service.read("/repo/other/default.rogen.json");

			expect(buildableConfig(entry)?.sourcePaths).toEqual([
				"/repo/other/lib",
			]);
			expect(entry.status).toBe("valid");
		});

		it("should put the problems of a broken config on the entry", async () => {
			await write("/repo/other/default.rogen.json", "{ nope");

			const entry = await service.read("/repo/other/default.rogen.json");

			expect(entry).toMatchObject({
				status: "broken",
				lastValid: undefined,
			});
		});
	});

	describe("registerFileCheck", () => {
		const hint = (file: string) => ({
			severity: DiagnosticSeverity.Error,
			code: "test.hint",
			resource: file,
			message: "a hint",
		});

		it("should add a check's hints to the errors of a file that fails to load", async () => {
			await write("/repo/a/default.rogen.json", {
				routes: { "a-b": "Nowhere" },
			});
			service.registerFileCheck(({ file }) => [hint(file)]);

			const entry = await service.read("/repo/a/default.rogen.json");

			expect(
				entry.status === "broken" &&
					entry.errors.map(({ code }) => code)
			).toEqual(expect.arrayContaining(["test.hint"]));
		});

		it("should fail a file that loads when a check has something to say about it", async () => {
			await write("/repo/a/default.rogen.json", { source: ["src"] });
			service.registerFileCheck(({ file }) => [hint(file)]);

			const entry = await service.read("/repo/a/default.rogen.json");

			expect(entry).toMatchObject({
				status: "broken",
				errors: [{ code: "test.hint" }],
			});
		});

		it("should hand the check what the file holds, or nothing when it doesn't parse", async () => {
			await write("/repo/a/default.rogen.json", { nope: true });
			await write("/repo/b/default.rogen.json", "{ nope");
			const seen: unknown[] = [];
			service.registerFileCheck(({ value }) => {
				seen.push(value);
				return [];
			});

			await service.read("/repo/a/default.rogen.json");
			await service.read("/repo/b/default.rogen.json");

			expect(seen).toEqual([{ nope: true }, undefined]);
		});

		it("should leave a config alone that the check has nothing to say about", async () => {
			await write("/repo/a/default.rogen.json", { routes: ROUTED });
			service.registerFileCheck(() => []);

			const entry = await service.read("/repo/a/default.rogen.json");

			expect(entry.status).toBe("valid");
		});

		it("should stop running once the registration is disposed", async () => {
			await write("/repo/a/default.rogen.json", { routes: ROUTED });
			const check = jest.fn(() => []);
			const registration = service.registerFileCheck(check);

			registration[Symbol.dispose]();
			await service.read("/repo/a/default.rogen.json");

			expect(check).not.toHaveBeenCalled();
		});
	});
});
