import { PlannedFile } from "../toolchain/toolchain.js";
import { agentBlock } from "./agent-block.js";

const AGENTS_MD = "AGENTS.md";
const CLAUDE_MD = "CLAUDE.md";
const MARKER = "<!-- rogen -->";

/** The file a repo's coding agents read, which takes Rogen's rules: `AGENTS.md`, else a lone `CLAUDE.md`, else a new `AGENTS.md`. */
export class AgentFile {
	private constructor(
		readonly fileName: string,
		/** What the file holds now; none when it doesn't exist. */
		private readonly text: string | undefined,
		/** What a `CLAUDE.md` beside `AGENTS.md` holds. */
		private readonly claudeText: string | undefined
	) {}

	/** One file only: a `CLAUDE.md` that imports `AGENTS.md` would load the rules twice. */
	static choose(
		agentsText: string | undefined,
		claudeText: string | undefined
	): AgentFile {
		if (agentsText !== undefined)
			return new AgentFile(AGENTS_MD, agentsText, claudeText);
		return claudeText !== undefined
			? new AgentFile(CLAUDE_MD, claudeText, undefined)
			: new AgentFile(AGENTS_MD, undefined, undefined);
	}

	static readonly FILE_NAMES = [AGENTS_MD, CLAUDE_MD] as const;

	get hasBlock(): boolean {
		return this.text?.includes(MARKER) ?? false;
	}

	/** The file with the block appended after a blank line, every byte before it kept, or the block alone. */
	get planned(): PlannedFile {
		if (this.text === undefined)
			return { fileName: this.fileName, content: agentBlock };
		const gap = this.text.endsWith("\n") ? "\n" : "\n\n";
		return {
			fileName: this.fileName,
			content: `${this.text}${gap}${agentBlock}`,
			appends: true,
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
