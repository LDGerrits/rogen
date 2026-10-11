import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";
import { MockRequestService } from "../../request/__tests__/mock-request-service.js";
import { CoreReleaseService } from "../core-release-service.js";

const URL = "https://api.github.com/repos/LDGerrits/rogen/releases?per_page=30";
const CACHE_FILE = "/cache/rogen/update-check.json";
const DAY = 24 * 60 * 60 * 1000;

const listing = (...tags: string[]) =>
	JSON.stringify(tags.map((tag_name) => ({ tag_name, draft: false })));

describe("CoreReleaseService", () => {
	let fs: MemoryFileSystemService;
	let requests: MockRequestService;
	let clock: number;
	let service: CoreReleaseService;

	const answer = (body: string, status = 200) =>
		requests.responses.set(URL, {
			status,
			contentType: "application/json; charset=utf-8",
			body: new TextEncoder().encode(body),
		});
	const cached = async () =>
		JSON.parse(await fs.readFile(CACHE_FILE)) as Record<string, unknown>;
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		requests = new MockRequestService();
		clock = 1_000 * DAY;
		service = new CoreReleaseService(fs, requests, "/cache", () => clock);
	});

	describe("published", () => {
		it("should answer none before a check has finished, and check beside it", async () => {
			answer(listing("v2.0.1", "v2.0.0-beta.2"));

			expect(await service.published()).toEqual([]);
			await settle();

			expect(requests.requested).toEqual([URL]);
			expect(await service.published()).toEqual([
				"2.0.1",
				"2.0.0-beta.2",
			]);
		});

		it("should not ask again within a day", async () => {
			answer(listing("v2.0.1"));
			await service.published();
			await settle();

			clock += DAY - 1;
			await service.published();
			await settle();

			expect(requests.requested).toHaveLength(1);
		});

		it("should ask again after a day, and answer from the cache meanwhile", async () => {
			answer(listing("v2.0.1"));
			await service.published();
			await settle();
			clock += DAY;
			answer(listing("v2.0.2", "v2.0.1"));

			expect(await service.published()).toEqual(["2.0.1"]);
			await settle();

			expect(await service.published()).toEqual(["2.0.2", "2.0.1"]);
		});

		it("should skip drafts and tags that are not versions", async () => {
			answer(
				JSON.stringify([
					{ tag_name: "v2.0.1", draft: true },
					{ tag_name: "nightly", draft: false },
					{ tag_name: "v2.0.0", draft: false },
				])
			);
			await service.published();
			await settle();

			expect(await service.published()).toEqual(["2.0.0"]);
		});

		it.each([
			["a refused connection", () => requests.responses.clear()],
			["a rate limit", () => answer("{}", 403)],
			["a body that is not JSON", () => answer("<html>")],
			["a listing of another shape", () => answer('{"message":"x"}')],
		])(
			"should keep what it knew after %s, and wait a day",
			async (_, fail) => {
				answer(listing("v2.0.1"));
				await service.published();
				await settle();
				clock += DAY;
				fail();
				await service.published();
				await settle();

				expect(await service.published()).toEqual(["2.0.1"]);
				expect((await cached()).checkedAt).toBe(clock);
			}
		);

		it("should read a cache file that is damaged as empty", async () => {
			await fs.writeFile(CACHE_FILE, "{ nope");

			expect(await service.published()).toEqual([]);
		});
	});

	describe("announce", () => {
		it("should announce a version once a day", async () => {
			expect(await service.announce("2.0.1")).toBe(true);
			expect(await service.announce("2.0.1")).toBe(false);

			clock += DAY - 1;
			expect(await service.announce("2.0.1")).toBe(false);

			clock += 1;
			expect(await service.announce("2.0.1")).toBe(true);
		});

		it("should announce a newer version at once", async () => {
			await service.announce("2.0.1");

			expect(await service.announce("2.0.2")).toBe(true);
		});

		it("should keep the versions a check found", async () => {
			answer(listing("v2.0.1"));
			await service.published();
			await settle();

			await service.announce("2.0.1");

			expect(await service.published()).toEqual(["2.0.1"]);
		});
	});

	it("should send who asks, as GitHub requires", async () => {
		await service.published();
		await settle();

		expect(
			requests.optionsGiven.map((options) => options?.headers)
		).toEqual([
			{ accept: "application/vnd.github+json", "user-agent": "rogen" },
		]);
	});
});
