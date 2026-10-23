import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { Darklua } from "../../toolchain/toolchain.js";
import { InitPlanBuilder } from "../init-plan-builder.js";
import { SyncSteps } from "../sync-steps.js";
import { directoryOf } from "./init-fixtures.js";

const luau = workspaceOf().languageFor("luau");
const robloxTs = workspaceOf().languageFor("roblox-ts");
const darklua = new Darklua();

describe("SyncSteps", () => {
	describe("compiledPath", () => {
		it("should be Darklua's output when Darklua processes the code", () => {
			expect(new SyncSteps(luau, darklua).compiledPath).toBe("dist");
		});

		it("should be Darklua's output rather than the compiler's when both are used", () => {
			expect(new SyncSteps(robloxTs, darklua).compiledPath).toBe("dist");
		});

		it("should be the compiler's output when there is one", () => {
			expect(new SyncSteps(robloxTs, undefined).compiledPath).toBe("out");
		});

		it("should be none for plain Luau", () => {
			expect(new SyncSteps(luau, undefined).compiledPath).toBeUndefined();
		});
	});

	describe("plan", () => {
		const target = directoryOf();

		const steps = (set: SyncSteps, luauLsp = false, folder?: string) => {
			const builder = new InitPlanBuilder(target, false, []);
			set.plan(builder, target.path, {
				processed: ["src"],
				compiledPath: set.compiledPath,
				luauLsp,
				folder,
			});
			return builder.build().unwrap().nextSteps;
		};

		it("should serve the project", () => {
			expect(steps(new SyncSteps(luau, undefined)).run).toEqual([
				"rogen serve",
			]);
		});

		it("should run the compiler before serving", () => {
			expect(steps(new SyncSteps(robloxTs, undefined)).run).toEqual([
				"rbxtsc -w",
				"rogen serve",
			]);
		});

		it("should run the project's own command to compile when it has one", () => {
			expect(
				steps(new SyncSteps(robloxTs, undefined, "npm run watch")).run
			).toEqual(["npm run watch", "rogen serve"]);
		});

		it("should watch the dirs into the compiled path beside the server when Darklua is used", () => {
			const { run } = steps(new SyncSteps(luau, darklua));

			expect(run).toEqual([
				"darklua process src dist --watch",
				"rogen serve",
			]);
		});

		it("should say how to keep the sourcemap Darklua reads current", () => {
			const { edits } = steps(new SyncSteps(luau, darklua));

			expect(edits).toEqual([
				expect.stringContaining(
					target.workspace.darklua.sourcemapCommand()
				),
			]);
		});

		it("should put the folder change on a line of its own, since PowerShell 5.1 has no &&", () => {
			const { run, edits } = steps(
				new SyncSteps(luau, darklua),
				false,
				"projects/game"
			);

			expect(run[0]).toBe(
				"cd projects/game\ndarklua process src dist --watch"
			);
			expect([...run, ...edits].join("\n")).not.toContain("&&");
		});

		it("should leave the sourcemap out where luau-lsp keeps it", () => {
			expect(steps(new SyncSteps(luau, darklua), true).edits).toEqual([]);
		});

		it("should not ask for a sourcemap of a compiler's output", () => {
			const { run, edits } = steps(new SyncSteps(robloxTs, darklua));

			expect([...run, ...edits].join("\n")).not.toContain("sourcemap");
		});
	});
});
