import fs from "fs";
import path from "path";
import {
	OUTPUT as AGENT_BLOCK,
	currentAgentBlockModule,
} from "./generate-agent-block.js";
import {
	OUTPUT as AGENT_HOOK,
	currentAgentHookModule,
} from "./generate-agent-hook.js";
import { OUTPUT as HELP, currentHelpModule } from "./generate-help.js";
import {
	OUTPUT as TEMPLATES,
	currentTemplatesModule,
} from "./generate-templates.js";

const modules = [
	[HELP, currentHelpModule],
	[AGENT_BLOCK, currentAgentBlockModule],
	[AGENT_HOOK, currentAgentHookModule],
	[TEMPLATES, currentTemplatesModule],
] as const;

// Skips a module that is already current, so a watcher doesn't see a change.
for (const [output, render] of modules) {
	const source = render();
	if (fs.existsSync(output) && fs.readFileSync(output, "utf8") === source)
		continue;
	fs.mkdirSync(path.dirname(output), { recursive: true });
	fs.writeFileSync(output, source);
}
