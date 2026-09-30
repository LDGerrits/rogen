import { SCHEMA_URL } from "../../config/config.js";
import { InitPlanBuilder } from "../init-plan.js";
import { directory, directoryOf } from "./init-fixtures.js";

describe("domain/init/init-plan", () => {
	describe("InitPlanBuilder", () => {
		const builderFor = (existing: readonly string[] = []) =>
			new InitPlanBuilder(directoryOf({ existing }));

		it("should write the template, then the configs, then the compiler's files, whatever order they were added in", () => {
			const builder = builderFor();
			builder.addCompilerFile({
				fileName: "tsconfig.lobby.json",
				content: "{}",
			});
			builder.addConfig("default", {});
			builder.setTemplate({
				fileName: "template.project.json",
				content: "{}",
			});
			builder.addConfig("lobby", {});

			const plan = builder.build().unwrap();

			expect(plan.files.map(({ fileName }) => fileName)).toEqual([
				"template.project.json",
				"default.rogen.json",
				"lobby.rogen.json",
				"tsconfig.lobby.json",
			]);
		});

		it("should point every config at the schema, before the fields it was given", () => {
			const builder = builderFor();
			builder.addConfig("default", { rootDirs: ["src"] });

			const [file] = builder.build().unwrap().files;

			expect(Object.keys(JSON.parse(file.content))).toEqual([
				"$schema",
				"rootDirs",
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
			builder.addRun("rogen watch", "rojo serve default.project.json");
			builder.addDarkluaCommands("darklua process src dist");
			builder.addEdit("one", "two");
			builder.addNote("second");

			const plan = builder.build().unwrap();

			expect(plan.notes).toEqual(["first", "second"]);
			expect(plan.nextSteps).toEqual({
				setup: [],
				run: [
					"rbxtsc -w",
					"rogen watch",
					"rojo serve default.project.json",
				],
				darklua: ["darklua process src dist"],
				edits: ["one", "two"],
			});
		});

		it("should say which directory the files go into", () => {
			expect(builderFor().build().unwrap().directory).toBe(directory);
		});

		it("should fail naming every config or compiler file that already exists", () => {
			const builder = builderFor([
				"default.rogen.json",
				"tsconfig.lobby.json",
			]);
			builder.addConfig("default", {});
			builder.addConfig("lobby", {});
			builder.addCompilerFile({
				fileName: "tsconfig.lobby.json",
				content: "{}",
			});

			const result = builder.build();

			expect(
				result.isErr() &&
					result.error.map(({ code, resource }) => [code, resource])
			).toEqual([
				["init.configExists", `${directory}/default.rogen.json`],
				["init.configExists", `${directory}/tsconfig.lobby.json`],
			]);
		});

		it("should not mind a template that already exists, which the setups use as it is", () => {
			const builder = builderFor(["template.project.json"]);
			builder.setTemplate({
				fileName: "template.project.json",
				content: "{}",
			});

			expect(builder.build().isOk()).toBe(true);
		});
	});
});
