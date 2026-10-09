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
		it("should give the answer named for the question", async () => {
			const prompts = new MockPromptService({ Language: "roblox-ts" });

			expect(
				await prompts.select({
					message: "Language",
					choices: [],
					initialValue: "luau",
				})
			).toBe("roblox-ts");
		});

		it("should take the default of a question it names no answer for", async () => {
			const prompts = new MockPromptService({});

			expect(
				await prompts.confirm({
					message: "Add modes?",
					initialValue: true,
				})
			).toBe(true);
		});

		it("should fail at a question it names no answer for that has no default", async () => {
			const prompts = new MockPromptService({});

			await expect(
				prompts.text({ message: "Config name" })
			).rejects.toThrow('No scripted answer for "Config name".');
		});

		it("should cancel a question named with CANCEL", async () => {
			const prompts = new MockPromptService({ Places: CANCEL });

			expect(
				await prompts.text({ message: "Places", placeholder: "lobby" })
			).toBeUndefined();
		});

		it("should fail when a question is asked again", async () => {
			const prompts = new MockPromptService({ Places: "lobby" });
			await prompts.text({ message: "Places" });

			await expect(prompts.text({ message: "Places" })).rejects.toThrow(
				'"Places" was asked again; script the answers as a list.'
			);
		});

		it("should not take an answer from Object's prototype", async () => {
			const prompts = new MockPromptService({});

			expect(
				await prompts.text({ message: "constructor", placeholder: "x" })
			).toBe("x");
		});

		it("should name the answers no question took yet", async () => {
			const prompts = new MockPromptService({
				Places: "lobby",
				Language: "luau",
			});
			await prompts.text({ message: "Places" });

			expect(prompts.unusedAnswers()).toEqual(["Language"]);

			await prompts.text({ message: "Language" });
		});
	});
});
