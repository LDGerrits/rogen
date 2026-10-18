import { SCHEMA_URL } from "../../config/config.js";
import { AgentFile } from "../agent/agent-file.js";
import { InitPlanBuilder } from "../init-plan-builder.js";
import { directory, directoryOf } from "./init-fixtures.js";

describe("domain/init/init-plan-builder", () => {
	describe("InitPlanBuilder", () => {
		const builderFor = (existing: readonly string[] = []) =>
			new InitPlanBuilder(directoryOf({ existing }), false, []);

		it("should write the config before the agent files", () => {
			const builder = builderFor();
			builder.addAgentFile(AgentFile.choose(() => undefined));
			builder.setConfig({});

			const plan = builder.build().unwrap();

			expect(plan.files.map(({ fileName }) => fileName)).toEqual([
				"rogen.json",
				"AGENTS.md",
			]);
			expect(plan.configs).toEqual(["rogen.json"]);
		});

		it("should write no config for a run that only adds agent files", () => {
			expect(builderFor().build().unwrap().configs).toEqual([]);
		});

		it("should point the config at the schema, before the fields it was given", () => {
			const builder = builderFor();
			builder.setConfig({ sourcePaths: ["src"] });

			const [file] = builder.build().unwrap().files;

			expect(Object.keys(JSON.parse(file.content))).toEqual([
				"$schema",
				"sourcePaths",
			]);
			expect(JSON.parse(file.content).$schema).toBe(SCHEMA_URL);
		});

		it("should say a one-time edit once, however many setups need it", () => {
			const builder = builderFor();
			builder.addSetup("Add include to tsconfig.json.");
			builder.addSetup(
				"Add include to tsconfig.json.",
				"Run npm install."
			);

			expect(builder.build().unwrap().nextSteps.setup).toEqual([
				"Add include to tsconfig.json.",
				"Run npm install.",
			]);
		});

		it("should keep the notes, commands and edits in the order they were added", () => {
			const builder = builderFor();
			builder.addNote("first");
			builder.addRun("rbxtsc -w");
			builder.addRun("rogen serve");
			builder.addEdit("one", "two");
			builder.addNote("second");

			const plan = builder.build().unwrap();

			expect(plan.notes).toEqual(["first", "second"]);
			expect(plan.nextSteps).toEqual({
				setup: [],
				run: ["rbxtsc -w", "rogen serve"],
				edits: ["one", "two"],
			});
		});

		it("should say which directory the files go into", () => {
			expect(builderFor().build().unwrap().directory).toBe(directory);
		});

		it("should fail naming the config when it already exists", () => {
			const builder = builderFor(["rogen.json"]);
			builder.setConfig({});

			const result = builder.build();

			expect(
				result.isErr() &&
					result.error.map(({ code, resource }) => [code, resource])
			).toEqual([["init.configExists", `${directory}/rogen.json`]]);
		});

		it("should not mind a project file that already exists, which the build replaces", () => {
			const builder = builderFor(["default.project.json"]);
			builder.setConfig({});

			expect(builder.build().isOk()).toBe(true);
		});
	});
});
