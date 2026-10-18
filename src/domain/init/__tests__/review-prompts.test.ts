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
		expect(
			await review.quick.multiSelect({
				message: "C",
				choices: [{ value: "x", label: "x" }],
				initialValues: ["x"],
			})
		).toEqual(["x"]);
		expect(
			await review.quick.text({ message: "D", placeholder: "src" })
		).toBe("src");
		expect(real.asked).toEqual([]);
		expect(review.asked).toBe(4);
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
		const real = new MockPromptService(["lib", false, ["a"], "lib, src"]);
		const review = new ReviewPrompts(real);
		await review.essential.text({
			message: "Source paths",
			placeholder: "src",
		});
		review.begin("customise");

		await review.quick.confirm({ message: "Darklua", initialValue: true });
		await review.quick.multiSelect({
			message: "Routes",
			choices: [
				{ value: "a", label: "a" },
				{ value: "b", label: "b" },
			],
			initialValues: ["a", "b"],
		});
		await review.quick.text({
			message: "Source paths",
			placeholder: "src",
		});
		review.begin("quick");

		expect(real.asked).toEqual([
			"Source paths",
			"Darklua",
			"Routes",
			"Source paths",
		]);
		expect(
			await review.quick.confirm({
				message: "Darklua",
				initialValue: true,
			})
		).toBe(false);
		expect(
			await review.quick.text({
				message: "Source paths",
				placeholder: "src",
			})
		).toBe("lib, src");
	});
});
