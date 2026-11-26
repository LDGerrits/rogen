import { Proposal } from "../draft-routing.js";
import { Choice, settle } from "../placements.js";

const encoder = new TextEncoder();

const writing = (file: string, text = "return 1"): Proposal => ({
	operations: [
		{
			kind: "write",
			file,
			instance: file,
			bytes: encoder.encode(text),
		},
	],
	landings: [],
});

const choiceOf = (
	instance: string,
	...candidates: Proposal[]
): Choice<Proposal> => ({
	instance,
	candidates,
	reason: "routing places it nowhere",
});

const verifyingNothing = async () => new Map<Proposal, string>();

describe("settle", () => {
	it("should place each choice at its first candidate when nothing misses", async () => {
		const first = writing("src/A.luau");
		const second = writing("src/B.luau");

		const { placed, refused } = await settle(
			[
				choiceOf("A", first, writing("dev/A.luau")),
				choiceOf("B", second),
			],
			verifyingNothing
		);

		expect(placed.map(({ candidate }) => candidate)).toEqual([
			first,
			second,
		]);
		expect(refused).toEqual([]);
	});

	it("should pass over a candidate that writes a file an earlier choice writes otherwise", async () => {
		const fallback = writing("dev/B.luau");

		const { placed } = await settle(
			[
				choiceOf("A", writing("src/A.luau", "return 1")),
				choiceOf("B", writing("src/A.luau", "return 2"), fallback),
			],
			verifyingNothing
		);

		expect(placed.map(({ candidate }) => candidate)[1]).toBe(fallback);
	});

	it("should take a candidate that writes the same bytes as an earlier choice", async () => {
		const same = writing("src/A.luau");

		const { placed } = await settle(
			[choiceOf("A", writing("src/A.luau")), choiceOf("B", same)],
			verifyingNothing
		);

		expect(placed.map(({ candidate }) => candidate)[1]).toBe(same);
	});

	it("should pass over a candidate that makes a folder where an earlier choice writes a file", async () => {
		const folder: Proposal = {
			operations: [{ kind: "folder", file: "src/A", instance: "B" }],
			landings: [],
		};

		const { refused } = await settle(
			[choiceOf("A", writing("src/A")), choiceOf("B", folder)],
			verifyingNothing
		);

		expect(refused).toEqual([
			{
				choice: expect.objectContaining({ instance: "B" }),
				reason: "src/A is already there",
			},
		]);
	});

	it("should verify the next candidate of a choice that missed together with the others", async () => {
		const missing = writing("src/A.luau");
		const next = writing("src/Shared/A.luau");
		const other = writing("src/B.luau");
		const verified: Proposal[][] = [];

		const { placed } = await settle(
			[choiceOf("A", missing, next), choiceOf("B", other)],
			async (chosen) => {
				verified.push([...chosen]);
				return new Map(
					chosen.includes(missing)
						? [
								[
									missing,
									"routing would make no instance of src/A.luau",
								],
							]
						: []
				);
			}
		);

		expect(verified).toEqual([
			[missing, other],
			[next, other],
		]);
		expect(placed.map(({ candidate }) => candidate)).toEqual([next, other]);
	});

	it("should refuse a choice whose every candidate missed for the reason of its first miss", async () => {
		const first = writing("src/A.luau");
		const second = writing("src/Shared/A.luau");

		const { placed, refused } = await settle(
			[choiceOf("A", first, second)],
			async (chosen) =>
				new Map(
					chosen.map((candidate) => [
						candidate,
						candidate === first ? "first miss" : "second miss",
					])
				)
		);

		expect(placed).toEqual([]);
		expect(refused.map(({ reason }) => reason)).toEqual(["first miss"]);
	});

	it("should refuse a choice with no candidates for its own reason", async () => {
		const { refused } = await settle([choiceOf("A")], verifyingNothing);

		expect(refused.map(({ reason }) => reason)).toEqual([
			"routing places it nowhere",
		]);
	});
});
