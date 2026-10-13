import { spawnSync } from "child_process";
import { readFileSync } from "fs";

/** A file of the Rojo the project pins, from its repository, or `undefined` when it can't be fetched. */
export function rojoSource(file: string): string | undefined {
	const version = /rojo-rbx\/rojo@(\S+?)"/.exec(
		readFileSync("rokit.toml", "utf8")
	)?.[1];
	const fetched = spawnSync(
		"curl",
		[
			"--fail",
			"--silent",
			"--max-time",
			"15",
			`https://raw.githubusercontent.com/rojo-rbx/rojo/v${version}/${file}`,
		],
		{ encoding: "utf8" }
	);
	return fetched.status === 0 ? fetched.stdout : undefined;
}

const requireSource = (name: string, _fn: () => void) =>
	describe(name, () => {
		it("should read Rojo's source", () => {
			throw new Error("Rojo's source could not be fetched.");
		});
	});

/** `describe` for tests that compare with Rojo's source: skipped offline, and a failure in CI. */
export function describeWithSource(source: string | undefined) {
	return source !== undefined
		? describe
		: process.env.CI
			? requireSource
			: describe.skip;
}
