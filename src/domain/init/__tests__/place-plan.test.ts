import { PlacePlan } from "../place-plan.js";

describe("PlacePlan", () => {
	it.each([
		[[], 34873],
		[[34872], 34873],
		[[34873, 34874], 34875],
		[[34873, 34875], 34874],
	])("should give a place with %j taken the port %d", (taken, port) => {
		expect(PlacePlan.freePort(taken)).toBe(port);
	});
});
