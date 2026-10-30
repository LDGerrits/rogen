type GlobPattern = string;

const MAGIC = /[(){}|[\]*?!+@]/g;

/** `directory` as a glob prefix matching only itself, so `a (1)` or `{b}` isn't read as pattern. */
export function escapedGlobPrefix(directory: string): string {
	return directory.replace(MAGIC, "[$&]");
}

/** `glob` as written, without the escapes of `escapedGlobPrefix`. */
export function unescapedGlob(glob: GlobPattern): string {
	return glob.replace(/\[([(){}|[\]*?!+@])\]/g, "$1");
}

/** `filePath` as a glob that matches only itself under Rust's globset. */
export function literalGlob(filePath: string): string {
	return filePath.replace(/[[\]{}*?]/g, "[$&]");
}

/** `glob` without the `!` that makes it re-include, and whether it had one; `\\!` is a literal `!`. */
export function negationOf(glob: GlobPattern): {
	readonly negated: boolean;
	readonly body: GlobPattern;
} {
	if (glob.startsWith("!")) return { negated: true, body: glob.slice(1) };
	return {
		negated: false,
		body: glob.startsWith("\\!") ? glob.slice(1) : glob,
	};
}

/** `glob` with `change` applied to its pattern, keeping a leading `!`. */
export function withGlobBody(
	glob: GlobPattern,
	change: (body: GlobPattern) => GlobPattern
): GlobPattern {
	const { negated, body } = negationOf(glob);
	return negated ? `!${change(body)}` : change(glob);
}

/** The glob of `globs` that ignores `path`, as Rojo reads `globIgnorePaths`: the last one that matches decides, and a `!` one re-includes. */
export function ignoringGlob(
	path: string,
	globs: readonly GlobPattern[]
): GlobPattern | undefined {
	let ignoring: GlobPattern | undefined;
	for (const glob of globs) {
		const { negated, body } = negationOf(glob);
		if (isGlobsetMatch(path, body)) ignoring = negated ? undefined : glob;
	}
	return ignoring;
}

/** Whether `glob` ignores everything in the folder `path`: it ends in `/**` and matches the folder before that. Rojo ignores nothing of a mounted folder for a glob that only names it, so naming it is not enough. */
export function ignoresAllOf(glob: GlobPattern, path: string): boolean {
	return (
		!negationOf(glob).negated &&
		glob.endsWith("/**") &&
		isGlobsetMatch(path, glob.slice(0, -3))
	);
}

/** The glob of `globs` that ignores everything in the folder `path`, when no `!` glob after it could re-include something. */
export function ignoringAllOf(
	path: string,
	globs: readonly GlobPattern[]
): GlobPattern | undefined {
	let ignoring: GlobPattern | undefined;
	for (const glob of globs)
		if (ignoresAllOf(glob, path)) ignoring = glob;
		else if (negationOf(glob).negated) ignoring = undefined;
	return ignoring;
}

const regExpCache = new Map<string, RegExp>();

/** Whether `path`, written with `/`, matches `glob` as Rust's globset, and so Rojo, reads it. */
export function isGlobsetMatch(path: string, glob: GlobPattern): boolean {
	let expression = regExpCache.get(glob);
	if (!expression) {
		expression = new RegExp(`^${globsetSource(glob)}$`, "s");
		regExpCache.set(glob, expression);
	}
	return expression.test(path);
}

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
				source = `${source.slice(0, -1)}/.*`;
			} else source += ".*";
			index = end;
		} else if (char === "?") source += ".";
		else if (char === "[") {
			const close = glob.indexOf("]", index + 2);
			if (close === -1) source += "\\[";
			else {
				const body = glob.slice(index + 1, close);
				const negated =
					body.length > 1 &&
					(body.startsWith("!") || body.startsWith("^"));
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
