import path from "path";
import { mockConfig } from "../../config/__tests__/mock-config-service.js";
import { leftOutDiagnostics } from "../left-out-diagnostics.js";
import { CompiledChange, SyncbackPlan } from "../syncback.js";

const cwd = path.resolve("/repo");
const file = path.join(cwd, "default.rogen.json");

const planOf = (
	compiled: CompiledChange[] = [],
	unplaced: SyncbackPlan["unplaced"] = []
): SyncbackPlan => ({
	project: mockConfig({ file, compiledPath: path.join(cwd, "out") }),
	changes: [],
	listed: [],
	unplaced,
	compiled,
});

describe("leftOutDiagnostics", () => {
	it("should say how to make each kind of change to compiled code", () => {
		expect(
			leftOutDiagnostics(
				planOf([
					{ instance: "ReplicatedStorage.A", kind: "changed" },
					{ instance: "ReplicatedStorage.B", kind: "added" },
				]),
				cwd
			).compiled.map(({ message }) => message)
		).toEqual([
			"ReplicatedStorage.A changed in the place, but it is compiled into out, so syncback left it out. Make the change in the source files.",
			"ReplicatedStorage.B is new in the place, but the project compiles into out, so syncback left it out. Add it to the source files.",
		]);
	});

	it("should warn about each instance left out, on the project file", () => {
		expect(
			leftOutDiagnostics(
				planOf(
					[],
					[{ instance: "Workspace.Part", reason: "it has no route" }]
				),
				cwd
			).unplaced
		).toMatchObject([
			{
				code: "syncback.unplaced",
				message: "Workspace.Part was left out: it has no route.",
			},
		]);
	});
});
