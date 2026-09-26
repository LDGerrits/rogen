import { jest } from "@jest/globals";
import { ConsolePromptService } from "../console-prompt-service.js";
import { KEY, ScriptedTerminal } from "./scripted-terminal.js";

describe("ConsolePromptService", () => {
	let terminal: ScriptedTerminal;
	let service: ConsolePromptService;

	beforeEach(() => {
		terminal = new ScriptedTerminal();
		service = new ConsolePromptService(terminal);
	});

	afterEach(() => {
		terminal[Symbol.dispose]();
	});

	describe("isInteractive", () => {
		it("should be true when both streams are terminals", () => {
			expect(service.isInteractive).toBe(true);
		});

		it("should be false when the input is not a terminal", () => {
			const piped = new ConsolePromptService({
				input: Object.assign(terminal.input, { isTTY: false }),
				output: terminal.output,
			});
			expect(piped.isInteractive).toBe(false);
		});
	});

	describe("text", () => {
		it("should resolve to the placeholder when Enter is pressed on an empty field", async () => {
			const answer = service.text({
				message: "Name",
				placeholder: "default",
			});
			await terminal.press(KEY.enter);
			expect(await answer).toBe("default");
		});

		it("should pass the placeholder to validate on an empty answer", async () => {
			const validate = jest.fn(() => undefined);
			const answer = service.text({
				message: "Name",
				placeholder: "default",
				validate,
			});
			await terminal.press(KEY.enter);
			await answer;
			expect(validate).toHaveBeenCalledWith("default");
		});

		it("should prefer typed input over the placeholder", async () => {
			const validate = jest.fn(() => undefined);
			const answer = service.text({
				message: "Name",
				placeholder: "default",
				validate,
			});
			await terminal.press("l", "o", "b", "b", "y", KEY.enter);
			expect(await answer).toBe("lobby");
			expect(validate).toHaveBeenCalledWith("lobby");
			expect(validate).not.toHaveBeenCalledWith("default");
		});

		it("should keep the prompt open when validate rejects the placeholder", async () => {
			const validate = jest.fn((value: string) =>
				value === "default" ? "Pick another name." : undefined
			);
			let settled = false;
			const answer = service
				.text({ message: "Name", placeholder: "default", validate })
				.finally(() => {
					settled = true;
				});

			await terminal.press(KEY.enter);
			expect(settled).toBe(false);
			expect(terminal.screen).toContain("Pick another name.");

			await terminal.press("a", KEY.enter);
			expect(await answer).toBe("a");
		});

		it("should resolve to undefined on Ctrl+C", async () => {
			const answer = service.text({ message: "Name" });
			await terminal.press(KEY.ctrlC);
			expect(await answer).toBeUndefined();
		});

		it("should show the description and hint under the message", async () => {
			const answer = service.text({
				message: "Root dirs",
				description: "Folders to scan.",
				hint: "Found code in: src",
			});
			await terminal.press(KEY.ctrlC);
			await answer;
			const lines = terminal.screen.split("\n");
			const message = lines.findIndex((line) => line.includes("Root dirs"));
			const description = lines.findIndex((line) =>
				line.includes("Folders to scan.")
			);
			const hint = lines.findIndex((line) =>
				line.includes("Found code in: src")
			);
			expect(message).toBeGreaterThanOrEqual(0);
			expect(description).toBeGreaterThan(message);
			expect(hint).toBeGreaterThan(description);
		});
	});

	describe("confirm", () => {
		it("should resolve to the initial value on Enter", async () => {
			const answer = service.confirm({
				message: "Add a place?",
				initialValue: false,
			});
			await terminal.press(KEY.enter);
			expect(await answer).toBe(false);
		});

		it("should resolve to true when y is pressed", async () => {
			const answer = service.confirm({
				message: "Add a place?",
				initialValue: false,
			});
			await terminal.press("y", KEY.enter);
			expect(await answer).toBe(true);
		});

		it("should resolve to undefined on Ctrl+C", async () => {
			const answer = service.confirm({ message: "Add a place?" });
			await terminal.press(KEY.ctrlC);
			expect(await answer).toBeUndefined();
		});
	});

	describe("select", () => {
		const choices = [
			{ value: "a", label: "A" },
			{ value: "b", label: "B" },
		] as const;

		it("should resolve to the initial value on Enter", async () => {
			const answer = service.select({
				message: "Pick",
				choices,
				initialValue: "b",
			});
			await terminal.press(KEY.enter);
			expect(await answer).toBe("b");
		});

		it("should resolve to the choice moved to", async () => {
			const answer = service.select({ message: "Pick", choices });
			await terminal.press(KEY.down, KEY.enter);
			expect(await answer).toBe("b");
		});

		it("should resolve to undefined on Ctrl+C", async () => {
			const answer = service.select({ message: "Pick", choices });
			await terminal.press(KEY.ctrlC);
			expect(await answer).toBeUndefined();
		});
	});

	describe("multiSelect", () => {
		const choices = [
			{ value: "a", label: "A" },
			{ value: "b", label: "B" },
		] as const;

		it("should resolve to the initial values on Enter", async () => {
			const answer = service.multiSelect({
				message: "Pick",
				choices,
				initialValues: ["b"],
			});
			await terminal.press(KEY.enter);
			expect(await answer).toEqual(["b"]);
		});

		it("should resolve to the toggled choices", async () => {
			const answer = service.multiSelect({ message: "Pick", choices });
			await terminal.press(KEY.space, KEY.down, KEY.space, KEY.enter);
			expect(await answer).toEqual(["a", "b"]);
		});

		it("should resolve to undefined on Ctrl+C", async () => {
			const answer = service.multiSelect({ message: "Pick", choices });
			await terminal.press(KEY.ctrlC);
			expect(await answer).toBeUndefined();
		});
	});
});
