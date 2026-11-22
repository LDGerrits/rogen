import { PortHolder, refuses } from "../serve-ports.js";

describe("refuses", () => {
	const info = { project: "repo", version: "7.7.1", session: "s1" };
	const record = {
		host: "127.0.0.1",
		port: 34872,
		project: "repo",
		projectFile: "/repo/default.project.json",
	};

	it.each<[PortHolder, boolean]>([
		[{ kind: "free" }, false],
		[{ kind: "taken" }, true],
		[{ kind: "foreign", info }, true],
		[{ kind: "pending", info }, true],
		[{ kind: "stale", info, record }, true],
		[{ kind: "unowned", info, record }, true],
		[{ kind: "ours", info, record }, false],
		[{ kind: "orphan", info, record }, false],
	])("should take %j as refusing serve: %s", (holder, refused) => {
		expect(refuses(holder)).toBe(refused);
	});
});
