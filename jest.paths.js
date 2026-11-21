import path from "path";
import process from "process";
import { expect } from "@jest/globals";

// On Windows a path the tests write as `/repo/src/A.luau` comes back as
// `C:\\repo\\src\\A.luau`; both spell one path.
const spelled = (text) =>
	text.replace(/(?<![\w])[A-Za-z]:(?=[\\/])/g, "").replace(/\\+/g, "/");

const poseAsWindowsTerminal = () => {
	process.env.WT_SESSION ??= "1";
};

if (path.sep === "\\") {
	poseAsWindowsTerminal();
	expect.addEqualityTesters([
		(a, b) =>
			typeof a === "string" && typeof b === "string"
				? spelled(a) === spelled(b)
				: undefined,
	]);
}
