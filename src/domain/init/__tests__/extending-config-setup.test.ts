import { SCHEMA_URL as SCHEMA } from "../../config/config.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { InitQuestions } from "../init-questions.js";
import { ExtendingConfigSetup } from "../extending-config-setup.js";
import { directoryOf, legacyPlan, planOf } from "./init-fixtures.js";

describe("ExtendingConfigSetup", () => {
	const extending = async (existing: readonly string[] = []) => {
		const target = directoryOf({ givenName: "prod", existing });
		const setup = new ExtendingConfigSetup(
			target,
			new InitQuestions(new MockPromptService([], false))
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
			run: ["rogen watch prod", "rojo serve prod.project.json"],
			darklua: [],
			edits: [
				'Turn variants on or off under "variants", or add "exclude", in prod.rogen.json.',
			],
		});
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
