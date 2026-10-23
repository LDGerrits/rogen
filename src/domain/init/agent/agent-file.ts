import { PlannedFile } from "../../toolchain/toolchain.js";
import { agentBlock } from "./agent-block.js";

const AGENTS_MD = "AGENTS.md";
const CLAUDE_MD = "CLAUDE.md";
const GEMINI_MD = "GEMINI.md";
const IMPORT = `@${AGENTS_MD}`;
const MARKER = "<!-- rogen -->";

/** The file of an agent that reads it in place of `AGENTS.md`. */
export type OwnFile = typeof CLAUDE_MD | typeof GEMINI_MD;

/** Appended after a blank line, every byte before it kept. */
function appended(text: string, addition: string): string {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const gap = text === "" ? "" : text.endsWith("\n") ? eol : `${eol}${eol}`;
	return `${text}${gap}${addition.replaceAll("\n", eol)}`;
}

/** The file a repo's coding agents read: `AGENTS.md`, else a lone `CLAUDE.md`, else a new `AGENTS.md`. Claude Code and Gemini CLI read their own file in its place, so theirs import it. */
export class AgentFile {
	static readonly FILE_NAMES = [AGENTS_MD, CLAUDE_MD, GEMINI_MD] as const;

	private constructor(
		readonly fileName: string,
		private readonly text: string | undefined,
		private readonly claudeText: string | undefined,
		private readonly geminiText: string | undefined
	) {}

	static choose(textOf: (fileName: string) => string | undefined): AgentFile {
		const agentsText = textOf(AGENTS_MD);
		const claudeText = textOf(CLAUDE_MD);
		const geminiText = textOf(GEMINI_MD);
		return agentsText === undefined &&
			claudeText !== undefined &&
			geminiText === undefined
			? new AgentFile(CLAUDE_MD, claudeText, undefined, undefined)
			: new AgentFile(AGENTS_MD, agentsText, claudeText, geminiText);
	}

	/** The file that holds Rogen's rules: this one, else the `CLAUDE.md` beside it. */
	get blockFileName(): string {
		return this.claudeText?.includes(MARKER) && !this.text?.includes(MARKER)
			? CLAUDE_MD
			: this.fileName;
	}

	get hasBlock(): boolean {
		return [this.text, this.claudeText, this.geminiText].some(
			(text) => text?.includes(MARKER) ?? false
		);
	}

	get planned(): PlannedFile {
		if (this.text === undefined)
			return { fileName: this.fileName, content: agentBlock };
		return {
			fileName: this.fileName,
			content: appended(this.text, agentBlock),
			addition: "Rogen's rules",
		};
	}

	/** The files that point Claude Code and Gemini CLI at `AGENTS.md` when the block goes there: an import appended to each of `CLAUDE.md` and `GEMINI.md` that has neither it nor the block, and a file holding only the import for each agent of `using` that has no file of its own. */
	imports(using: readonly OwnFile[]): PlannedFile[] {
		if (this.fileName !== AGENTS_MD) return [];
		return (
			[
				[CLAUDE_MD, this.claudeText],
				[GEMINI_MD, this.geminiText],
			] as const
		).flatMap(([fileName, text]): PlannedFile[] => {
			if (text === undefined)
				return using.includes(fileName)
					? [{ fileName, content: `${IMPORT}\n` }]
					: [];
			return text.includes(IMPORT) || text.includes(MARKER)
				? []
				: [
						{
							fileName,
							content: appended(text, `${IMPORT}\n`),
							addition: `an import of ${AGENTS_MD}`,
						},
					];
		});
	}
}
