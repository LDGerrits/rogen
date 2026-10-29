import { MockPromptService } from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { ReviewPrompts } from "../review-prompts.js";

describe("ReviewPrompts", () => {
	it("should take the default of a quick question without asking", async () => {
		const real = new MockPromptService([]);
		const review = new ReviewPrompts(real);

		expect(
			await review.quick.confirm({ message: "A", initialValue: false })
		).toBe(false);
		expect(
			await review.quick.select({
				message: "B",
				choices: [
					{ value: "x", label: "x" },
					{ value: "y", label: "y" },
				],
				initialValue: "y",
			})
		).toBe("y");
		expect(real.asked).toEqual([]);
		expect(review.asked).toBe(2);
	});

	it("should ask an essential question, and not ask it twice", async () => {
		const real = new MockPromptService(["luau"]);
		const review = new ReviewPrompts(real);
		const language = () =>
			review.essential.select({
				message: "Language",
				choices: [{ value: "luau", label: "Luau" }],
			});

		expect(await language()).toBe("luau");
		expect(await language()).toBe("luau");
		expect(real.asked).toEqual(["Language"]);
	});

	it("should ask every question when customising, with the answer given before preselected", async () => {
		const real = new MockPromptService(["roblox-ts", false, "luau"]);
		const review = new ReviewPrompts(real);
		const language = () =>
			review.essential.select({
				message: "Language",
				choices: [
					{ value: "luau", label: "Luau" },
					{ value: "roblox-ts", label: "roblox-ts" },
				],
			});
		await language();
		review.begin("customise");

		await review.quick.confirm({ message: "Hook", initialValue: true });
		await language();
		review.begin("quick");

		expect(real.asked).toEqual(["Language", "Hook", "Language"]);
		expect(
			await review.quick.confirm({ message: "Hook", initialValue: true })
		).toBe(false);
		expect(await language()).toBe("luau");
	});
});
