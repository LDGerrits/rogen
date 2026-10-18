import { PlannedFile } from "../../toolchain/toolchain.js";
import { agentBlock } from "./agent-block.js";

const AGENTS_MD = "AGENTS.md";
const CLAUDE_MD = "CLAUDE.md";
const MARKER = "<!-- rogen -->";

/** The file a repo's coding agents read: `AGENTS.md`, else a lone `CLAUDE.md`, else a new `AGENTS.md`. */
export class AgentFile {
	static readonly FILE_NAMES = [AGENTS_MD, CLAUDE_MD] as const;

	/** The `CLAUDE.md` that points Claude Code at `AGENTS.md`, for a project that has Claude Code's folder and no file of its own for it. */
	static readonly CLAUDE_IMPORT: PlannedFile = {
		fileName: CLAUDE_MD,
		content: `@${AGENTS_MD}\n`,
	};

	private constructor(
		readonly fileName: string,
		private readonly text: string | undefined,
		private readonly claudeText: string | undefined
	) {}

	static choose(textOf: (fileName: string) => string | undefined): AgentFile {
		const agentsText = textOf(AGENTS_MD);
		const claudeText = textOf(CLAUDE_MD);
		if (agentsText !== undefined)
			return new AgentFile(AGENTS_MD, agentsText, claudeText);
		return claudeText !== undefined
			? new AgentFile(CLAUDE_MD, claudeText, undefined)
			: new AgentFile(AGENTS_MD, undefined, undefined);
	}

	/** Whether a `CLAUDE.md` is there, which Claude Code reads in place of `AGENTS.md`. */
	get hasClaudeFile(): boolean {
		return this.claudeText !== undefined;
	}

	/** The file that holds Rogen's rules: this one, else the `CLAUDE.md` beside it. */
	get blockFileName(): string {
		return this.claudeText?.includes(MARKER) && !this.text?.includes(MARKER)
			? CLAUDE_MD
			: this.fileName;
	}

	get hasBlock(): boolean {
		return [this.text, this.claudeText].some(
			(text) => text?.includes(MARKER) ?? false
		);
	}

	/** Appended after a blank line, every byte before it kept. */
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

	/** Claude Code reads `CLAUDE.md`, not `AGENTS.md`, so a `CLAUDE.md` beside it must import it. */
	get nextStep(): string | undefined {
		return this.claudeText !== undefined &&
			!this.claudeText.includes(`@${AGENTS_MD}`)
			? `Add @${AGENTS_MD} to ${CLAUDE_MD}, so Claude Code reads Rogen's rules.`
			: undefined;
	}
}
