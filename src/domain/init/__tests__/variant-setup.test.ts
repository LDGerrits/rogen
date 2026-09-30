import { SCHEMA_URL as SCHEMA } from "../../config/config.js";
import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { InitQuestions } from "../init-questions.js";
import { VariantSetup } from "../variant-setup.js";
import { directoryOf, legacyPlan, planOf } from "./init-fixtures.js";

describe("VariantSetup", () => {
	const variant = async (existing: readonly string[] = []) => {
		const target = directoryOf({ givenName: "prod", existing });
		const setup = new VariantSetup(
			target,
			new InitQuestions(new MockPromptService([], false))
		);
		return { asked: await setup.ask(), setup, target };
	};

	it("should write a config that only extends default", async () => {
		const { setup, target } = await variant();

		const plan = legacyPlan(planOf(setup, target).unwrap());

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
				'Turn tags on or off under "tags", or add "exclude", in prod.rogen.json.',
			],
		});
	});

	it("should fail when the variant's config exists", async () => {
		const { asked } = await variant(["prod.rogen.json"]);

		expect(asked.isErr()).toBe(true);
	});

	it("should fail when the variant's project file exists", async () => {
		const { asked } = await variant(["prod.project.json"]);

		expect(asked.isErr()).toBe(true);
	});
});
