import { MockRequestService } from "../../../platform/request/__tests__/mock-request-service.js";
import { ReleaseFeed } from "../release-feed.js";

const URL = "https://api.github.com/repos/LDGerrits/rogen/releases?per_page=30";

const listing = (...tags: string[]) =>
	JSON.stringify(tags.map((tag_name) => ({ tag_name, draft: false })));

describe("ReleaseFeed", () => {
	let requests: MockRequestService;
	let feed: ReleaseFeed;

	const answer = (body: string, status = 200) =>
		requests.responses.set(URL, {
			status,
			contentType: "application/json; charset=utf-8",
			body: new TextEncoder().encode(body),
		});

	beforeEach(() => {
		requests = new MockRequestService();
		feed = new ReleaseFeed(requests);
	});

	it("should name the versions the tags carry", async () => {
		answer(listing("v2.0.1", "v2.0.0-beta.2", "2.0.0-rc-1", "v2.1.0-rc-1"));

		expect(await feed.fetch()).toEqual([
			"2.0.1",
			"2.0.0-beta.2",
			"2.0.0-rc-1",
			"2.1.0-rc-1",
		]);
	});

	it("should skip drafts and tags that are not versions", async () => {
		answer(
			JSON.stringify([
				{ tag_name: "v2.0.1", draft: true },
				{ tag_name: "nightly", draft: false },
				{ tag_name: 7, draft: false },
				null,
				{ tag_name: "v2.0.0", draft: false },
			])
		);

		expect(await feed.fetch()).toEqual(["2.0.0"]);
	});

	it.each([
		["a refused connection", () => requests.responses.clear()],
		["a rate limit", () => answer("{}", 403)],
		["a body that is not JSON", () => answer("<html>")],
		["a listing of another shape", () => answer('{"message":"x"}')],
	])("should name none after %s", async (_, fail) => {
		fail();

		expect(await feed.fetch()).toEqual([]);
	});

	it("should say who asks, as GitHub requires", async () => {
		await feed.fetch();

		expect(requests.requested).toEqual([URL]);
		expect(
			requests.optionsGiven.map((options) => options?.headers)
		).toEqual([
			{ accept: "application/vnd.github+json", "user-agent": "rogen" },
		]);
	});
});
