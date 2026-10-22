import { ServePlan, ServeTarget } from "../../../domain/serve/serve-service.js";
import { ServerMessage } from "../../../domain/runner/rojo-server.js";
import { MockLogService } from "../../../platform/log/__tests__/mock-log-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { ServeLog } from "../serve-log.js";

const plan = {} as ServePlan;
const target = {} as ServeTarget;

const banner: ServerMessage = {
	severity: "debug",
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
	new ServeLog(logService, "/repo", plan).said({ target, message });

describe("ServeLog server output", () => {
	it("should print a stdout line as the server printed it where there is no frame", () => {
		const logService = new MockLogService();

		say(logService, banner);

		expect(logService.lines).toEqual(["print: Port:    34872"]);
	});

	it("should print a stdout line while a terminal has no frame open", () => {
		const logService = new MockLogService();
		logService.drawsFrame = true;

		say(logService, banner);

		expect(logService.lines).toEqual(["print: Port:    34872"]);
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
			severity: "info",
			text: "Something new",
			stdout: "Something new",
		});

		expect(logService.lines).toEqual(["info: Rojo: Something new"]);
	});

	it("should leave out a blank stdout line inside a frame", () => {
		const logService = framedLog();

		say(logService, { severity: "debug", text: "", stdout: "" });

		expect(logService.lines).toEqual([]);
	});

	it("should write a line that is no stdout line at the level the server said it", () => {
		const logService = framedLog();

		say(logService, { severity: "warning", text: "Careful" });

		expect(logService.lines).toEqual(["warn: Rojo: Careful"]);
	});
});
