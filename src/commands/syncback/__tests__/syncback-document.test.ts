import path from "path";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import { SyncbackPlan } from "../../../domain/syncback/syncback.js";
import { warningDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { syncbackEntry } from "../syncback-document.js";

const cwd = path.resolve("/repo");
const file = path.join(cwd, "default.rogen.json");

const planOf = (): SyncbackPlan => ({
	project: mockConfig({ file, compiledPath: path.join(cwd, "out") }),
	changes: [{ kind: "write", file: path.join(cwd, "src/A.luau") }],
	listed: [],
	unplaced: [],
	compiled: [],
});

describe("syncbackEntry", () => {
	it("should name no config when syncback did not run", () => {
		expect(syncbackEntry("game.rbxl", { kind: "notRun" }, cwd)).toEqual({
			outcome: "notRun",
			config: null,
			input: "game.rbxl",
			changes: [],
			unplaced: [],
		});
	});

	it("should hold the warnings of a plan, relative to the working directory", () => {
		const entry = syncbackEntry(
			"game.rbxl",
			{
				kind: "planned",
				plan: planOf(),
				warnings: [
					warningDiagnostic("x.warn", { resource: file }, "Careful."),
				],
				unplaced: [],
				compiled: [],
				asked: false,
			},
			cwd
		);

		expect(entry).toMatchObject({
			outcome: "wouldWrite",
			config: "default.rogen.json",
			diagnostics: [{ code: "x.warn", message: "Careful." }],
		});
	});
});
