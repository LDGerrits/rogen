import picomatch from "picomatch";
import { isWindows } from "./platform.js";

type GlobPattern = string;

const MAGIC = /[(){}|[\]*?!+@]/g;

/** `directory` as a glob prefix that matches only itself: a folder named `a (1)` or `{b}` would otherwise be read as part of the pattern. */
export function escapedGlobPrefix(directory: string): string {
	return directory.replace(MAGIC, "[$&]");
}

/** `glob` as its author wrote it, with the escapes of `escapedGlobPrefix` taken off. */
export function unescapedGlob(glob: GlobPattern): string {
	return glob.replace(/\[([(){}|[\]*?!+@])\]/g, "$1");
}

export function isMatch(path: string, glob: GlobPattern): boolean {
	return picomatch.isMatch(path, glob, {
		dot: true,
		windows: isWindows,
	});
}

const regExpCache = new Map<string, RegExp>();

/** Whether `path`, written with `/`, matches `glob` as Rust's globset reads it, which is what Rojo reads: `*`, `?` and `[...]` cross folders, `**` is a whole run of them, and `{a,b}` offers alternatives. */
export function isGlobsetMatch(path: string, glob: GlobPattern): boolean {
	let expression = regExpCache.get(glob);
	if (!expression) {
		expression = new RegExp(`^${globsetSource(glob)}$`, "s");
		regExpCache.set(glob, expression);
	}
	return expression.test(path);
}

/** The regular expression source for `glob`. */
function globsetSource(glob: string): string {
	let source = "";
	let depth = 0;
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index];
		if (char === "\\" && index + 1 < glob.length) {
			source += escapedChar(glob[++index]);
		} else if (char === "*") {
			let end = index;
			while (glob[end + 1] === "*") end++;
			const run = end - index + 1;
			const atStart = index === 0 || glob[index - 1] === "/";
			if (run >= 2 && atStart && glob[end + 1] === "/") {
				source += "(?:.*/)?";
				end++;
			} else if (
				run >= 2 &&
				glob[index - 1] === "/" &&
				end === glob.length - 1
			) {
				source = `${source.slice(0, -1)}(?:/.*)?`;
			} else source += ".*";
			index = end;
		} else if (char === "?") source += ".";
		else if (char === "[") {
			const close = glob.indexOf("]", index + 2);
			if (close === -1) source += "\\[";
			else {
				const body = glob.slice(index + 1, close);
				const negated = body.startsWith("!") || body.startsWith("^");
				const set = (negated ? body.slice(1) : body).replace(
					/[\\^\]]/g,
					"\\$&"
				);
				source += `[${negated ? "^" : ""}${set}]`;
				index = close;
			}
		} else if (char === "{") {
			depth++;
			source += "(?:";
		} else if (char === "}" && depth > 0) {
			depth--;
			source += ")";
		} else if (char === "," && depth > 0) source += "|";
		else source += escapedChar(char);
	}
	return source + ")".repeat(depth);
}

function escapedChar(char: string): string {
	return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
