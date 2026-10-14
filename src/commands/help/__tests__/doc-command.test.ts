import { jest } from "@jest/globals";
import { UsageError } from "../../../base/errors.js";
import { ResultError } from "../../../base/result.js";
import { MockBrowserService } from "../../../platform/browser/__tests__/mock-browser-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { DOCS_URL } from "../../../platform/product/product-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import {
	CommandHarness,
	commandHarness,
} from "../../__tests__/command-harness.js";
import "../doc-command.js";
import { helpTexts } from "../help-texts.js";

describe("doc command", () => {
	let logService: NullLogService;
	let print: ReturnType<typeof jest.spyOn>;
	let browser: MockBrowserService;

	const harnessFor = (
		interactive: boolean
	): CommandHarness<NullLogService> => {
		const environment = new MockEnvironmentService(
			"/repo",
			LogLevel.Info,
			interactive
		);
		return commandHarness({ log: logService, environment, browser });
	};

	const doc = (interactive: boolean, ...positionals: string[]) =>
		harnessFor(interactive).run("doc", { positionals });

	beforeEach(() => {
		logService = new NullLogService();
		print = jest.spyOn(logService, "print");
		browser = new MockBrowserService();
	});

	it("should open the documentation in a terminal, and print where it is", async () => {
		const result = await doc(true);

		expect(result.isOk()).toBe(true);
		expect(browser.opened).toEqual([DOCS_URL]);
		expect(print).toHaveBeenCalledWith(DOCS_URL);
	});

	it("should print the URL and open nothing without a terminal", async () => {
		await doc(false);

		expect(browser.opened).toEqual([]);
		expect(print).toHaveBeenCalledWith(DOCS_URL);
	});

	it.each(["routing", "config", "layout", "output"])(
		"should print the %s topic as written, and open nothing",
		async (topic) => {
			const result = await doc(true, topic);

			expect(result.isOk()).toBe(true);
			expect(print).toHaveBeenCalledWith(helpTexts.topics[topic]);
			expect(browser.opened).toEqual([]);
		}
	);

	it("should read a topic in any case", async () => {
		await doc(false, "Routing");

		expect(print).toHaveBeenCalledWith(helpTexts.topics.routing);
	});

	it("should suggest the topic a misspelled one is closest to, as a usage error", async () => {
		const result = await doc(false, "rouing");

		expect((result as ResultError<Error>).error).toBeInstanceOf(UsageError);
		expect((result as ResultError<Error>).error.message).toBe(
			"Unknown topic \"rouing\". Did you mean 'rogen doc routing'?"
		);
	});

	it("should list the topics when none is close", async () => {
		const result = await doc(false, "zzzzzzzz");

		expect((result as ResultError<Error>).error.message).toBe(
			'Unknown topic "zzzzzzzz". The topics are routing, config, layout, output.'
		);
	});
});
