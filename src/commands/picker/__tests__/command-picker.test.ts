import { CancelledError, UsageError } from "../../../base/errors.js";
import { ResultError } from "../../../base/result.js";
import {
	CommandRegistry,
	Extensions,
} from "../../../platform/commands/commands.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import {
	CANCEL,
	MockPromptService,
	PromptScript,
} from "../../../platform/prompt/__tests__/mock-prompt-service.js";
import { Registry } from "../../../platform/registry/registry.js";
import { commandHarness } from "../../__tests__/command-harness.js";
import "../../build/build-command.js";
import "../../check/check-command.js";
import "../../fmt-project/fmt-project-command.js";
import "../../help/doc-command.js";
import "../../help/help-command.js";
import "../../init/init-command.js";
import "../../list/list-command.js";
import "../../plugin/plugin-command.js";
import "../../serve/serve-command.js";
import "../../sourcemap/sourcemap-command.js";
import "../../syncback/syncback-command.js";
import "../../upload/upload-command.js";
import "../../where/where-command.js";
import { CommandPicker, PickerProject } from "../command-picker.js";

const registry = Registry.as<CommandRegistry>(Extensions.Commands);

const ids = [...registry.getCommands().keys()];

describe("CommandPicker", () => {
	describe("order", () => {
		const all = [
			"build",
			"check",
			"doc",
			"fmt-project",
			"help",
			"init",
			"list",
			"plugin",
			"serve",
			"sourcemap",
			"syncback",
			"upload",
			"where",
		];

		it("should put init first where there is no config, and doc and help last", () => {
			const order = CommandPicker.order(all, false);

			expect(order.slice(0, 2)).toEqual(["init", "build"]);
			expect(order.slice(-2)).toEqual(["doc", "help"]);
		});

		it("should put serve, build, where and check first beside a config", () => {
			const order = CommandPicker.order(all, true);

			expect(order.slice(0, 5)).toEqual([
				"serve",
				"build",
				"where",
				"check",
				"fmt-project",
			]);
			expect(order.slice(-2)).toEqual(["doc", "help"]);
		});

		it("should list every command once", () => {
			for (const configured of [true, false])
				expect(
					[...CommandPicker.order(all, configured)].sort()
				).toEqual([...all].sort());
		});

		it("should leave out a command that isn't registered", () => {
			expect(CommandPicker.order(["help", "list"], true)).toEqual([
				"list",
				"help",
			]);
		});
	});

	describe("the commands", () => {
		it("should find the commands", () => {
			expect(ids).toContain("plugin");
			expect(ids.length).toBeGreaterThan(10);
		});

		it.each(ids)("should give %s a one-line summary", (id) => {
			const summary = registry.getCommand(id)?.metadata.summary ?? "";

			expect(summary).not.toBe("");
			expect(summary).not.toContain("\n");
		});

		it.each(ids.filter((id) => id !== "serve"))(
			"should declare a picker step for %s if a bare run of it is a usage error",
			async (id) => {
				const result = await commandHarness().run(id);

				const lacksInput =
					result.isErr() &&
					(result as ResultError<Error>).error instanceof UsageError;
				expect(
					lacksInput
						? (registry.getCommand(id)?.metadata.picker?.length ??
								0)
						: 1
				).toBeGreaterThan(0);
			}
		);
	});

	describe("pick", () => {
		const project = (
			name: string | undefined,
			files: readonly string[] = []
		): PickerProject => ({
			describe: async () => ({ version: "2.0.0", name }),
			files: async () => files,
		});

		const run = async (
			answers: PromptScript,
			options: { name?: string; files?: readonly string[] } = {}
		) => {
			const prompts = new MockPromptService(answers, true);
			const log = new MockLogService();
			const result = await new CommandPicker(
				registry,
				prompts,
				log,
				project(
					"name" in options ? options.name : "my-game",
					options.files
				)
			).pick();
			return { result, prompts, log };
		};

		const picked = async (...args: Parameters<typeof run>) =>
			(await run(...args)).result.unwrap();

		it("should show the version and the project in one line", async () => {
			const { log } = await run(["help"]);

			expect(log.texts("intro")).toEqual(["rogen 2.0.0 · my-game"]);
		});

		it("should say there is no config where none is", async () => {
			const { log } = await run(["init"], { name: undefined });

			expect(log.texts("intro")).toEqual([
				"rogen 2.0.0 · no default.rogen.json here",
			]);
		});

		it("should offer every command with its summary, in the order of the folder", async () => {
			const { prompts } = await run(["help"]);

			expect(prompts.prompts[0].offered).toEqual(
				CommandPicker.order(ids, true)
			);
		});

		it("should preselect the first command of the order", async () => {
			const withConfig = await run({ "Run a command": "help" });
			const without = await run(
				{ "Run a command": "init" },
				{ name: undefined }
			);

			expect(withConfig.prompts.prompts[0].offered?.[0]).toBe("serve");
			expect(without.prompts.prompts[0].offered?.[0]).toBe("init");
		});

		it("should run a command that needs nothing bare", async () => {
			expect(await picked(["list"])).toEqual(["list"]);
		});

		it("should say the command line it runs", async () => {
			const { log } = await run(["list"]);

			expect(log.texts("outro")).toEqual(["› rogen list"]);
		});

		it("should ask install or uninstall for plugin", async () => {
			expect(await picked(["plugin", "install"])).toEqual([
				"plugin",
				"install",
			]);
			expect(await picked(["plugin", "uninstall"])).toEqual([
				"plugin",
				"uninstall",
			]);
		});

		it("should say the whole command line for plugin", async () => {
			const { log } = await run(["plugin", "install"]);

			expect(log.texts("outro")).toEqual(["› rogen plugin install"]);
		});

		describe("syncback", () => {
			const files = ["game.rbxl", "places/lobby.rbxlx"];

			it("should offer the place files found, and typing a path", async () => {
				const { prompts } = await run(["syncback", "game.rbxl"], {
					files,
				});

				expect(prompts.prompts[1].offered).toEqual([...files, ""]);
			});

			it("should take the file picked as --input", async () => {
				expect(
					await picked(["syncback", "places/lobby.rbxlx"], { files })
				).toEqual(["syncback", "--input", "places/lobby.rbxlx"]);
			});

			it("should take a path that is typed", async () => {
				expect(
					await picked(["syncback", "", "other.rbxl"], { files })
				).toEqual(["syncback", "--input", "other.rbxl"]);
			});

			it("should ask for a path when no file is found", async () => {
				const { result, prompts } = await run([
					"syncback",
					"mine.rbxm",
				]);

				expect(result.unwrap()).toEqual([
					"syncback",
					"--input",
					"mine.rbxm",
				]);
				expect(prompts.prompts[1].offered).toBeUndefined();
			});

			it("should quote a path with a space in the line it says", async () => {
				const { log } = await run(["syncback", "my game.rbxl"]);

				expect(log.texts("outro")).toEqual([
					'› rogen syncback --input "my game.rbxl"',
				]);
			});
		});

		it("should refuse an empty path for syncback, which can't run without --input", async () => {
			await expect(run(["syncback", ""])).rejects.toThrow(
				"A path to a place or model file is needed."
			);
		});

		it("should refuse an empty asset ID, as it has no default to stand for one", async () => {
			await expect(run(["upload", ""])).rejects.toThrow(
				"An asset ID is a number."
			);
		});

		it("should take the asset ID of upload as --asset_id", async () => {
			expect(await picked(["upload", "123456"])).toEqual([
				"upload",
				"--asset_id",
				"123456",
			]);
		});

		it("should refuse an asset ID that is not a number", async () => {
			await expect(run(["upload", "abc"])).rejects.toThrow(
				"An asset ID is a number."
			);
		});

		describe("doc", () => {
			it("should open the documentation without a topic", async () => {
				expect(await picked(["doc", ""])).toEqual(["doc"]);
			});

			it("should print the topic picked", async () => {
				expect(await picked(["doc", "routing"])).toEqual([
					"doc",
					"routing",
				]);
			});
		});

		it("should show help in full, as a command, so it exits 0", async () => {
			expect(await picked(["help"])).toEqual(["help"]);
		});

		describe("cancelling", () => {
			it("should be a cancelled run when the command is not picked", async () => {
				const { result } = await run([CANCEL]);

				expect((result as ResultError<Error>).error).toBeInstanceOf(
					CancelledError
				);
			});

			it("should be a cancelled run when an answer is not given", async () => {
				const { result, log } = await run(["plugin", CANCEL]);

				expect((result as ResultError<Error>).error).toBeInstanceOf(
					CancelledError
				);
				expect(log.texts("outro")).toEqual([]);
			});
		});
	});
});
