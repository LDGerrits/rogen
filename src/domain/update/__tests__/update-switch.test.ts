import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { UpdateSwitch } from "../update-switch.js";

const switchOf = (
	options: {
		interactive?: boolean;
		plain?: boolean;
		level?: LogLevel;
		variables?: Record<string, string>;
	} = {}
) => {
	const {
		interactive = true,
		plain = !interactive,
		level,
		variables,
	} = options;
	return new UpdateSwitch(
		new MockEnvironmentService(
			"/repo",
			level,
			interactive,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			variables,
			plain
		)
	);
};

describe("UpdateSwitch", () => {
	it("should be on for a person in a terminal", () => {
		expect(switchOf().isOn).toBe(true);
	});

	it("should be off without a terminal", () => {
		expect(switchOf({ interactive: false }).isOn).toBe(false);
	});

	it("should be off under --quiet in a terminal", () => {
		expect(switchOf({ level: LogLevel.Error }).isOn).toBe(false);
	});

	it("should be off under --json in a terminal", () => {
		expect(switchOf({ plain: true }).isOn).toBe(false);
	});

	it.each([
		["ROGEN_NO_UPDATE_CHECK", "1"],
		["ROGEN_NO_UPDATE_CHECK", "true"],
		["ROGEN_NO_UPDATE_CHECK", "TRUE"],
		["NO_UPDATE_NOTIFIER", "1"],
	])("should be off with %s=%s", (name, value) => {
		expect(switchOf({ variables: { [name]: value } }).isOn).toBe(false);
	});

	it.each(["", "0", "false"])(
		"should stay on when the opt-out is '%s'",
		(value) => {
			expect(
				switchOf({ variables: { ROGEN_NO_UPDATE_CHECK: value } }).isOn
			).toBe(true);
		}
	);
});
