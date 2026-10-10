import { PlannedFile } from "../toolchain/toolchain.js";
import { agentBlock } from "./agent-block.js";

const AGENTS_MD = "AGENTS.md";
const CLAUDE_MD = "CLAUDE.md";
const MARKER = "<!-- rogen -->";

/** The file a repo's coding agents read, which takes Rogen's rules: `AGENTS.md`, else a lone `CLAUDE.md`, else a new `AGENTS.md`. */
export class AgentFile {
	private constructor(
		readonly fileName: string,
		private readonly text: string | undefined,
		/** A `CLAUDE.md` beside `AGENTS.md`, which may already hold the block, or not import it. */
		private readonly claudeText: string | undefined
	) {}

	/** One file only: a `CLAUDE.md` that imports `AGENTS.md` would load the rules twice. `textOf` gives the text of each of `FILE_NAMES`, or `undefined` when it isn't there. */
	static choose(textOf: (fileName: string) => string | undefined): AgentFile {
		const agentsText = textOf(AGENTS_MD);
		const claudeText = textOf(CLAUDE_MD);
		if (agentsText !== undefined)
			return new AgentFile(AGENTS_MD, agentsText, claudeText);
		return claudeText !== undefined
			? new AgentFile(CLAUDE_MD, claudeText, undefined)
			: new AgentFile(AGENTS_MD, undefined, undefined);
	}

	static readonly FILE_NAMES = [AGENTS_MD, CLAUDE_MD] as const;

	/** Whether either agent file already holds the block, so a second copy would load twice. */
	get hasBlock(): boolean {
		return [this.text, this.claudeText].some(
			(text) => text?.includes(MARKER) ?? false
		);
	}

	/** The file with the block appended after a blank line, every byte before it kept, or the block alone. */
	get planned(): PlannedFile {
		if (this.text === undefined)
			return { fileName: this.fileName, content: agentBlock };
		const eol = this.text.includes("\r\n") ? "\r\n" : "\n";
		const gap = this.text.endsWith("\n") ? eol : `${eol}${eol}`;
		return {
			fileName: this.fileName,
			content: `${this.text}${gap}${agentBlock.replaceAll("\n", eol)}`,
			addition: "Rogen's rules",
		};
	}

	/** Claude Code reads `CLAUDE.md`, so one beside `AGENTS.md` has to import it to see the rules. */
	get nextStep(): string | undefined {
		return this.claudeText !== undefined &&
			!this.claudeText.includes(`@${AGENTS_MD}`)
			? `Add @${AGENTS_MD} to ${CLAUDE_MD}, so Claude Code reads Rogen's rules.`
			: undefined;
	}
}
