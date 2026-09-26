import { generateUuid } from "../uuid.js";

describe("uuid", () => {
	describe("generateUuid", () => {
		it("should return a version 4 uuid", () => {
			expect(generateUuid()).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
			);
		});

		it("should return a different value on each call", () => {
			expect(generateUuid()).not.toBe(generateUuid());
		});
	});
});
