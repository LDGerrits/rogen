import path from "path";
import {
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import {
	WriteRun,
	WriteSet,
	WriteSummary,
	FailedConfig,
	OutputFile,
	UnloadedConfig,
	WrittenConfig,
} from "../write.js";
import {
	brokenEntry,
	MockConfigSelection,
	mockEntry,
	selectionOf,
} from "../../config/__tests__/mock-config-service.js";
import { abs, configOf } from "./fixtures.js";

const projectFile = path.resolve("/repo", "default.project.json");
const staged = (file: string, id: string) => `${file}.${id}.tmp`;

const summary: WriteSummary = {
	roots: [],
	routes: [],
	unrouted: 0,
	replaced: 0,
	displaced: 0,
};

describe("domain/write/write", () => {
	describe("WriteRun", () => {
		const lobby = configOf({
			file: abs("lobby/default.rogen.json"),
			name: "lobby",
		});
		const arena = configOf({
			file: abs("arena/default.rogen.json"),
			name: "arena",
		});
		const shared = warningDiagnostic(
			"x.shared",
			{ resource: abs("src/A.luau") },
			"shared"
		);
		const ownFile = (file: string) =>
			warningDiagnostic("x.own", { resource: file }, "own");
		const written = (
			config: typeof lobby,
			warnings: ReturnType<typeof warningDiagnostic>[],
			syncWarnings: ReturnType<typeof warningDiagnostic>[] = []
		) =>
			new WrittenConfig(
				config,
				"wrote",
				{ warnings, syncWarnings },
				summary,
				[]
			);

		it("should count a warning several configs share once", () => {
			const run = new WriteRun([
				written(lobby, [shared]),
				written(arena, [shared]),
			]);

			expect(run.warningCount).toBe(1);
			expect(run.diagnostics).toEqual([shared]);
			expect(run.shares[1].warnings).toEqual({
				fresh: [],
				sameAs: [lobby.file],
			});
		});

		it("should take a warning about each config's own file as the same one", () => {
			const run = new WriteRun([
				written(lobby, [ownFile(lobby.file)]),
				written(arena, [ownFile(arena.file)]),
			]);

			expect(run.warningCount).toBe(1);
		});

		it("should count compiled path warnings with the rest", () => {
			const run = new WriteRun([written(lobby, [], [shared])]);

			expect(run.warningCount).toBe(1);
		});

		it("should fail with every error, and say each error once", () => {
			const error = errorDiagnostic(
				"x.error",
				{ resource: abs("src/A.luau") },
				"broken"
			);
			const run = new WriteRun([
				new FailedConfig(lobby, [error]),
				new UnloadedConfig(abs("arena/default.rogen.json"), [error]),
			]);

			expect(run.failed).toBe(true);
			expect(run.errors).toEqual([error, error]);
			expect(run.diagnostics).toEqual([error]);
			expect(run.shares[1].errors.sameAs).toEqual([lobby.file]);
		});

		it("should not fail a run whose configs all written", () => {
			expect(new WriteRun([written(lobby, [shared])]).failed).toBe(false);
		});

		it("should fail a run with its errors, and not with its warnings", () => {
			const error = errorDiagnostic(
				"x.error",
				{ resource: abs("src/A.luau") },
				"broken"
			);
			const warned = new WriteRun([written(lobby, [shared])]);
			const broken = new WriteRun([new FailedConfig(lobby, [error])]);

			expect(warned.failure()).toBeUndefined();
			expect(broken.failure()).toMatchObject({ diagnostics: [error] });
			expect(new WriteRun([]).failure()).toBeUndefined();
		});
	});

	describe("OutputFile", () => {
		it("should match the staging files of any writer", () => {
			const { stagingPattern } = new OutputFile(projectFile);

			expect(stagingPattern.test(staged(projectFile, "a1b2"))).toBe(true);
			expect(stagingPattern.test(staged(projectFile, "c3d4"))).toBe(true);
		});

		it("should not match the project file itself or another file", () => {
			const { stagingPattern } = new OutputFile(projectFile);

			expect(stagingPattern.test(`${projectFile}.tmp`)).toBe(false);
			expect(stagingPattern.test(projectFile)).toBe(false);
			expect(
				stagingPattern.test(
					staged(path.resolve("/repo", "other.project.json"), "a1b2")
				)
			).toBe(false);
		});
	});

	describe("WriteSet", () => {
		const lobby = configOf({
			file: abs("lobby/default.rogen.json"),
			name: "lobby",
		});
		const arena = configOf({
			file: abs("arena/default.rogen.json"),
			name: "arena",
		});
		const failure = errorDiagnostic(
			"config.invalid",
			{ resource: abs("arena/default.rogen.json") },
			"broken"
		);

		it("should hold the configs of a selection when every one is valid", () => {
			const set = WriteSet.of(selectionOf(lobby, arena)).unwrap();

			expect(set.configs).toEqual([lobby, arena]);
			expect(set.configOf(abs("arena/default.project.json"))).toBe(arena);
			expect(
				set.configOf(abs("other/default.project.json"))
			).toBeUndefined();
		});

		it("should fail with every error when a config of the selection is broken", () => {
			const selection = new MockConfigSelection([
				mockEntry({}, abs("lobby/default.rogen.json")),
				brokenEntry([failure], abs("arena/default.rogen.json")),
			]);

			const set = WriteSet.of(selection);

			expect(set.isErr() && set.error.diagnostics).toEqual([failure]);
		});

		it("should split a selection into the configs that load and the writes that did not", () => {
			const selection = new MockConfigSelection([
				{
					status: "valid",
					file: lobby.file,
					config: lobby,
				},
				brokenEntry([failure], abs("arena/default.rogen.json")),
			]);

			const { set, unloaded } = WriteSet.partition(selection);

			expect(set.configs).toEqual([lobby]);
			expect(unloaded).toEqual([
				new UnloadedConfig(abs("arena/default.rogen.json"), [failure]),
			]);
		});

		it("should list the source paths of configs with routes, and the default source path of one without", () => {
			const routed = configOf({
				file: abs("lobby/default.rogen.json"),
				sourcePaths: [abs("lobby/server"), abs("lobby/shared")],
			});
			const unrouted = configOf({
				file: abs("arena/default.rogen.json"),
				sourcePaths: [],
				routes: {},
			});

			expect(new WriteSet([routed, unrouted]).indexedPaths).toEqual([
				abs("lobby/server"),
				abs("lobby/shared"),
				abs("arena/src"),
			]);
		});
	});
});
