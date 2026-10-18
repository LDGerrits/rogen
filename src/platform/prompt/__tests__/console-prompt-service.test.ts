import { jest } from "@jest/globals";
import { ConsolePromptService } from "../console-prompt-service.js";
import { KEY, ScriptedTerminal } from "./scripted-terminal.js";

describe("ConsolePromptService", () => {
	let terminal: ScriptedTerminal;
	let service: ConsolePromptService;

	beforeEach(() => {
		terminal = new ScriptedTerminal();
		service = new ConsolePromptService({
			...terminal,
			interactive: true,
			color: true,
		});
	});

	afterEach(() => {
		terminal[Symbol.dispose]();
	});

	describe("isInteractive", () => {
		it("should be true when the environment says a person can answer", () => {
			expect(service.isInteractive).toBe(true);
		});

		it("should be false when the environment says no one can answer", () => {
			const declined = new ConsolePromptService({
				...terminal,
				interactive: false,
				color: true,
			});
			expect(declined.isInteractive).toBe(false);
		});
	});

	describe("colours", () => {
		const hintCode = "\u001b[2m";

		const drawn = async (color: boolean) => {
			const service = new ConsolePromptService({
				...terminal,
				interactive: true,
				color,
			});
			const asked = service.confirm({ message: "Go?", hint: "a hint" });
			await terminal.press(KEY.enter);
			await asked;
			return terminal.raw;
		};

		it("should dim the hint when colours are on", async () => {
			expect(await drawn(true)).toContain(hintCode);
		});

		it("should draw none of its own escape codes when colours are off", async () => {
			const raw = await drawn(false);

			expect(raw).toContain("Go?");
			expect(raw).not.toContain(hintCode);
		});
	});

	describe("frame", () => {
		const details = {
			description: "Folders to scan.",
			hint: "Found code in: src",
		};
		const prompts = {
			text: () => service.text({ message: "Source paths", ...details }),
			confirm: () =>
				service.confirm({ message: "Source paths", ...details }),
			select: () =>
				service.select({
					message: "Source paths",
					choices: [{ value: "a", label: "A" }],
					...details,
				}),
			multiSelect: () =>
				service.multiSelect({
					message: "Source paths",
					choices: [{ value: "a", label: "A" }],
					...details,
				}),
		};

		for (const [kind, ask] of Object.entries(prompts)) {
			it(`should show the details while a ${kind} is open and drop them once answered`, async () => {
				const answer = ask();
				await terminal.press();
				const open = terminal.screen;
				await terminal.press(KEY.enter);
				await answer;
				const answered = terminal.screen.slice(open.length);

				expect(open).toContain("Folders to scan.");
				expect(open).toContain("Found code in: src");
				expect(answered).toContain("Source paths");
				expect(answered).not.toContain("Folders to scan.");
				expect(answered).not.toContain("Found code in: src");
			});

			it(`should draw one gutter per line for a ${kind}`, async () => {
				const answer = ask();
				await terminal.press(KEY.enter);
				await answer;
				expect(terminal.screen).not.toMatch(/│\s+│/);
			});
		}

		it("should wrap a long description under the gutter", async () => {
			const words = Array(30).fill("scan").join(" ");
			const answer = service.text({
				message: "Source paths",
				description: words,
			});
			await terminal.press(KEY.ctrlC);
			await answer;
			const lines = terminal.screen
				.split("\n")
				.filter((line) => line.includes("scan"));
			expect(lines.length).toBeGreaterThan(1);
			for (const line of lines) expect(line).toMatch(/^│/);
		});

		it("should show every choice's hint, not only the focused one", async () => {
			const answer = service.multiSelect({
				message: "Routes",
				choices: [
					{ value: "a", label: "A", hint: "→ first" },
					{ value: "b", label: "B", hint: "→ second" },
				],
			});
			await terminal.press();
			expect(terminal.screen).toContain("→ first");
			expect(terminal.screen).toContain("→ second");
			await terminal.press(KEY.ctrlC);
			await answer;
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
				message: "Source paths",
				description: "Folders to scan.",
				hint: "Found code in: src",
			});
			await terminal.press(KEY.ctrlC);
			await answer;
			const lines = terminal.screen.split("\n");
			const message = lines.findIndex((line) =>
				line.includes("Source paths")
			);
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

	describe("autocomplete", () => {
		const choices = [
			{ value: "build", label: "build", hint: "Builds a project" },
			{ value: "serve", label: "serve", hint: "Serves with Rojo" },
			{ value: "where", label: "where", hint: "Shows a route" },
		] as const;

		it("should resolve to the first choice on Enter", async () => {
			const answer = service.autocomplete({ message: "Pick", choices });
			await terminal.press(KEY.enter);
			expect(await answer).toBe("build");
		});

		it("should resolve to the initial value on Enter", async () => {
			const answer = service.autocomplete({
				message: "Pick",
				choices,
				initialValue: "serve",
			});
			await terminal.press(KEY.enter);
			expect(await answer).toBe("serve");
		});

		it("should resolve to the choice moved to", async () => {
			const answer = service.autocomplete({ message: "Pick", choices });
			await terminal.press(KEY.down, KEY.enter);
			expect(await answer).toBe("serve");
		});

		it("should narrow the choices to those matching what is typed", async () => {
			const answer = service.autocomplete({ message: "Pick", choices });
			await terminal.press("w", "h", KEY.enter);
			expect(await answer).toBe("where");
		});

		it("should match the hint too", async () => {
			const answer = service.autocomplete({ message: "Pick", choices });
			await terminal.press(..."rojo", KEY.enter);
			expect(await answer).toBe("serve");
		});

		it("should list every choice with its hint", async () => {
			const answer = service.autocomplete({ message: "Pick", choices });
			await terminal.press(KEY.enter);
			await answer;
			expect(terminal.screen).toContain("serve  Serves with Rojo");
		});

		it("should say when nothing matches", async () => {
			const answer = service.autocomplete({ message: "Pick", choices });
			await terminal.press("z", "z");
			expect(terminal.screen).toContain("No matches found");
			await terminal.press(KEY.ctrlC);
			await answer;
		});

		it("should resolve to undefined on Ctrl+C", async () => {
			const answer = service.autocomplete({ message: "Pick", choices });
			await terminal.press(KEY.ctrlC);
			expect(await answer).toBeUndefined();
		});
	});
});
