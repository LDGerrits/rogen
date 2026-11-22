import { configOf } from "../../write/__tests__/fixtures.js";
import { MirrorPlan } from "../mirror-plan.js";
import { CompiledChange } from "../syncback.js";

const compiledOf = (changes: readonly CompiledChange[]) =>
	new MirrorPlan(configOf(), [], changes, [], new Map(), [], []).compiled;

describe("MirrorPlan", () => {
	it("should list an instance changed more than one way once, by the change that says most", () => {
		expect(
			compiledOf([
				{ instance: "ServerScriptService/Combat", kind: "added" },
				{ instance: "ServerScriptService/Combat", kind: "changed" },
				{ instance: "ServerScriptService/Combat", kind: "removed" },
			])
		).toEqual([{ instance: "ServerScriptService/Combat", kind: "added" }]);
	});

	it("should leave out an instance added inside one that was added, but keep a change inside it", () => {
		expect(
			compiledOf([
				{ instance: "ServerScriptService/Combat", kind: "added" },
				{ instance: "ServerScriptService/Combat/Hit", kind: "added" },
				{ instance: "ServerScriptService/Combat/Run", kind: "changed" },
			])
		).toEqual([
			{ instance: "ServerScriptService/Combat", kind: "added" },
			{ instance: "ServerScriptService/Combat/Run", kind: "changed" },
		]);
	});
});
