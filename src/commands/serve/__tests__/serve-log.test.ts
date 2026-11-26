import { LogService } from "../../../platform/log/log-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import {
	ServePlan,
	ServeTarget,
	ServedTarget,
} from "../../../domain/serve/serve-service.js";
import { ServeAddress } from "../../../domain/serve/serve.js";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import { ServerMessage } from "../../../domain/runner/rojo-server.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { ServeJsonLog, ServeLog } from "../serve-log.js";

const plan = {} as ServePlan;
const target = {} as ServeTarget;

const banner: ServerMessage = {
	severity: "noise",
	text: "Port:    34872",
	stdout: "Port:    34872",
};

const framedLog = () => {
	const logService = new MockLogService();
	logService.drawsFrame = true;
	logService.intro("rogen serve · repo");
	logService.clear();
	return logService;
};

const say = (logService: MockLogService, message: ServerMessage) =>
	instantiationOf([LogService, logService])
		.createInstance(ServeLog, "/repo", plan)
		.said({ target, message });

describe("ServeLog server output", () => {
	it("should drop the banner where there is no frame", () => {
		const logService = new MockLogService();

		say(logService, banner);

		expect(logService.lines).toEqual([]);
	});

	it("should write a stdout line Rogen does not recognise as an info line where there is no frame", () => {
		const logService = new MockLogService();

		say(logService, {
			severity: "unrecognised",
			text: "Something new",
			stdout: "Something new",
		});

		expect(logService.lines).toEqual(["info: Rojo: Something new"]);
	});

	it("should show a line Rogen drops as noise only with --verbose inside a frame", () => {
		const logService = framedLog();

		say(logService, banner);

		expect(logService.lines).toEqual([]);

		logService.setLevel(LogLevel.Debug);
		say(logService, banner);

		expect(logService.lines).toEqual(["debug: Rojo: Port:    34872"]);
	});

	it("should write a stdout line Rogen does not recognise as an info line inside a frame", () => {
		const logService = framedLog();

		say(logService, {
			severity: "unrecognised",
			text: "Something new",
			stdout: "Something new",
		});

		expect(logService.lines).toEqual(["info: Rojo: Something new"]);
	});

	it("should leave out a blank stdout line inside a frame", () => {
		const logService = framedLog();

		say(logService, { severity: "noise", text: "", stdout: "" });

		expect(logService.lines).toEqual([]);
	});

	it("should write a line that is no stdout line at the level the server said it", () => {
		const logService = framedLog();

		say(logService, { severity: "warning", text: "Careful" });

		expect(logService.lines).toEqual(["warn: Rojo: Careful"]);
	});
});

describe("ServeLog and ServeJsonLog events", () => {
	const config = mockConfig({ file: "/repo/default.rogen.json" });
	const servingTarget: ServeTarget = {
		config,
		project: "repo",
		address: new ServeAddress("localhost", 34872),
	};
	const servedTarget: ServedTarget = {
		...servingTarget,
		servedBy: { project: "repo", version: "7.7.1" },
	};
	const planOf = (target: ServeTarget) =>
		({
			target,
			selection: { configs: [], home: "/repo" },
		}) as unknown as ServePlan;

	const textLog = (target: ServeTarget = servingTarget) => {
		const logService = new MockLogService();
		logService.setLevel(LogLevel.Debug);
		const log = instantiationOf([LogService, logService]).createInstance(
			ServeLog,
			"/repo",
			planOf(target)
		);
		return { log, logService };
	};

	const jsonLog = (target: ServeTarget = servingTarget) => {
		const logService = new MockLogService();
		const log = instantiationOf([LogService, logService]).createInstance(
			ServeJsonLog,
			"/repo",
			planOf(target)
		);
		const lines = () =>
			logService.texts("result").map((line) => JSON.parse(line));
		return { log, lines };
	};

	it("should name the server without a session under --verbose", () => {
		const { log, logService } = textLog();

		log.serving({
			target: servingTarget,
			info: { project: "repo", version: "7.7.1" },
		});

		expect(logService.texts("debug")).toEqual(["Rojo 7.7.1 serves repo."]);
	});

	it("should say another rogen serve serves the project, without a session", () => {
		const { log, logService } = textLog();

		log.changed({ kind: "servedElsewhere", target: servedTarget });

		expect(logService.texts("info")).toEqual([
			"default.rogen.json is already served by another rogen serve: Rojo 7.7.1 serves a project named repo at localhost:34872.",
		]);
	});

	it("should say why it stopped serving a config that is gone", () => {
		const { log, logService } = textLog();

		log.changed({
			kind: "retired",
			target: servingTarget,
			reason: "removed",
		});

		expect(logService.texts("info")).toEqual([
			"Stopped serving default.rogen.json: its config is gone.",
		]);
	});

	it("should warn about a left-running Rojo it could not end, with no owner it knows", () => {
		const { log, logService } = textLog();

		log.changed({
			kind: "orphan",
			target: servingTarget,
			pid: 41,
			error: "EPERM",
		});

		expect(logService.texts("warn")).toEqual([
			"Couldn't end the Rojo (process 41) that a rogen serve left running: EPERM",
		]);
	});

	it("should print an error as an error line", () => {
		const { log, logService } = textLog();

		log.error(new Error("the watcher broke"));

		expect(logService.texts("error")).toEqual(["the watcher broke"]);
	});

	it("should open with a serving line when another rogen serve serves the target", () => {
		const { log, lines } = jsonLog(servedTarget);

		log.begin();

		expect(lines()).toEqual([
			{
				serving: {
					config: "default.rogen.json",
					version: "7.7.1",
					project: "repo",
					host: "localhost",
					port: 34872,
					reportsConnections: false,
					alreadyRunning: true,
				},
			},
		]);
	});

	it("should print a serving line when another rogen serve takes the target over", () => {
		const { log, lines } = jsonLog();

		log.changed({ kind: "servedElsewhere", target: servedTarget });

		expect(lines()).toEqual([
			{ serving: expect.objectContaining({ alreadyRunning: true }) },
		]);
	});

	it("should print an orphan it could not end with the error", () => {
		const { log, lines } = jsonLog();

		log.changed({
			kind: "orphan",
			target: servingTarget,
			pid: 41,
			error: "EPERM",
		});

		expect(lines()).toEqual([
			{
				orphan: {
					config: "default.rogen.json",
					pid: 41,
					ended: false,
					error: "EPERM",
				},
			},
		]);
	});

	it("should print an error as a JSON line", () => {
		const { log, lines } = jsonLog();

		log.error(new Error("the watcher broke"));

		expect(lines()).toEqual([
			{
				error: expect.objectContaining({
					message: expect.stringContaining("the watcher broke"),
				}),
			},
		]);
	});
});
