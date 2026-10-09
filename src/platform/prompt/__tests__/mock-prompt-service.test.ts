import { CANCEL, MockPromptService } from "./mock-prompt-service.js";

describe("MockPromptService", () => {
	it("should answer in order, failing once the answers run out", async () => {
		const prompts = new MockPromptService(["a"]);

		expect(await prompts.text({ message: "First" })).toBe("a");
		await expect(prompts.text({ message: "Second" })).rejects.toThrow(
			'No scripted answer for "Second".'
		);
	});

	describe("with answers by question", () => {
		const prompts = () =>
			new MockPromptService({ Language: "roblox-ts", Places: CANCEL });

		it("should give the answer named for the question", async () => {
			expect(
				await prompts().select({
					message: "Language",
					choices: [],
					initialValue: "luau",
				})
			).toBe("roblox-ts");
		});

		it("should take the default of a question it names no answer for", async () => {
			expect(
				await prompts().confirm({
					message: "Add modes?",
					initialValue: true,
				})
			).toBe(true);
		});

		it("should cancel a question named with CANCEL", async () => {
			expect(
				await prompts().text({
					message: "Places",
					placeholder: "lobby",
				})
			).toBeUndefined();
		});
	});
});
