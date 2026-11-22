import path from "path";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import {
	CompiledChange,
	SyncbackPlan,
} from "../../../domain/syncback/syncback.js";
import { warningDiagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { compiledDiagnostics, syncbackEntry } from "../syncback-document.js";

const cwd = path.resolve("/repo");
const file = path.join(cwd, "default.rogen.json");

const planOf = (compiled: CompiledChange[] = []): SyncbackPlan => ({
	project: mockConfig({ file, compiledPath: path.join(cwd, "out") }),
	changes: [{ kind: "write", file: path.join(cwd, "src/A.luau") }],
	listed: [],
	unplaced: [],
	compiled,
});

describe("compiledDiagnostics", () => {
	it("should say how to make each kind of change to compiled code", () => {
		expect(
			compiledDiagnostics(
				planOf([
					{ instance: "ReplicatedStorage.A", kind: "changed" },
					{ instance: "ReplicatedStorage.B", kind: "added" },
				])
			).map(({ message }) => message)
		).toEqual([
			"ReplicatedStorage.A changed in the place, but it is compiled into out, so syncback left it out. Make the change in the source files.",
			"ReplicatedStorage.B is new in the place, but the project compiles into out, so syncback left it out. Add it to the source files.",
		]);
	});
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
