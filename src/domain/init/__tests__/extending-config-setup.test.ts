import { SCHEMA_URL as SCHEMA } from "../../config/config.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { InitQuestions } from "../init-questions.js";
import { ExtendingConfigSetup } from "../extending-config-setup.js";
import { WorkspaceSpec } from "../../toolchain/__tests__/workspaces.js";
import { directoryOf, legacyPlan, planOf } from "./init-fixtures.js";

describe("ExtendingConfigSetup", () => {
	const extending = async (
		existing: readonly string[] = [],
		workspace?: WorkspaceSpec
	) => {
		const target = directoryOf({ givenName: "prod", existing, workspace });
		const setup = new ExtendingConfigSetup(
			target,
			new InitQuestions(new MockPromptService([], false), false)
		);
		return { asked: await setup.ask(), setup, target };
	};

	it("should write a config that only extends default", async () => {
		const { asked, setup, target } = await extending();

		const plan = legacyPlan(
			planOf(setup, asked.unwrap()!, target).unwrap()
		);

		expect(plan.configs.map(({ fileName }) => fileName)).toEqual([
			"prod.rogen.json",
		]);
		expect(JSON.parse(plan.configs[0].content)).toEqual({
			$schema: SCHEMA,
			extends: "./default.rogen.json",
		});
		expect(plan.nextSteps).toEqual({
			setup: [],
			run: ["rogen serve prod"],
			darklua: [],
			edits: [
				'Add "exclude" or "modes", or pin a "mode", in prod.rogen.json.',
			],
		});
	});

	it("should write a synced twin beside a Darklua default, and serve it", async () => {
		const { asked, setup, target } = await extending([], {
			darkluaConfig: ".darklua.json",
		});

		const plan = legacyPlan(
			planOf(setup, asked.unwrap()!, target).unwrap()
		);

		expect(
			plan.configs.map(({ fileName, content }) => [
				fileName,
				JSON.parse(content),
			])
		).toEqual([
			[
				"prod.rogen.json",
				{ $schema: SCHEMA, extends: "./default.rogen.json" },
			],
			[
				"prod-sync.rogen.json",
				{
					$schema: SCHEMA,
					extends: "./prod.rogen.json",
					syncDir: "dist",
				},
			],
		]);
		expect(plan.nextSteps.run).toEqual(["rogen serve prod-sync"]);
	});

	it("should fail when the synced twin's config exists", async () => {
		const { asked } = await extending(["prod-sync.rogen.json"], {
			darkluaConfig: ".darklua.json",
		});

		expect(asked.isErr()).toBe(true);
	});

	it("should fail when the extending config's config exists", async () => {
		const { asked } = await extending(["prod.rogen.json"]);

		expect(asked.isErr()).toBe(true);
	});

	it("should fail when the extending config's project file exists", async () => {
		const { asked } = await extending(["prod.project.json"]);

		expect(asked.isErr()).toBe(true);
	});
});
