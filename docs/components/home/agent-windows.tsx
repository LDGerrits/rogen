"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { FileIcon, VsCodeWindow } from "../ide";
import { useLang, type Lang } from "./lang";

// One agent per feature, each writing one file of its own feature, which requires only that feature.
const AGENTS: {
	feature: Record<Lang, string>;
	colour: string;
	file: Record<Lang, string>;
	code: Record<Lang, string>;
}[] = [
	{
		feature: { luau: "Combat", ts: "combat" },
		colour: "--agent-1",
		file: {
			luau: "CombatService@Server.luau",
			ts: "combat-service@server.ts",
		},
		code: {
			luau: `local ReplicatedStorage = game:GetService("ReplicatedStorage")

local CombatTypes = require(ReplicatedStorage.Shared.Combat.CombatTypes)

local CombatService = {}

function CombatService.dealDamage(target: Model, hit: CombatTypes.Hit)
	local humanoid = target:FindFirstChildOfClass("Humanoid")
	if humanoid and humanoid.Health > 0 then
		humanoid:TakeDamage(hit.damage)
	end
end

return CombatService`,
			ts: `import { Hit } from "./combat-types";

export function dealDamage(target: Model, hit: Hit) {
	const humanoid = target.FindFirstChildOfClass("Humanoid");
	if (humanoid && humanoid.Health > 0) {
		humanoid.TakeDamage(hit.damage);
	}
}`,
		},
	},
	{
		feature: { luau: "Inventory", ts: "inventory" },
		colour: "--agent-2",
		file: {
			luau: "InventoryService@Server.luau",
			ts: "inventory-service@server.ts",
		},
		code: {
			luau: `local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ItemCatalog = require(ReplicatedStorage.Shared.Inventory.ItemCatalog)

local InventoryService = {}
local bags: { [Player]: { string } } = {}

function InventoryService.give(player: Player, itemId: string)
	assert(ItemCatalog[itemId], \`unknown item {itemId}\`)
	local bag = bags[player] or {}
	table.insert(bag, itemId)
	bags[player] = bag
end

return InventoryService`,
			ts: `import { ItemCatalog } from "./item-catalog";

const bags = new Map<Player, string[]>();

export function give(player: Player, itemId: string) {
	assert(ItemCatalog[itemId], \`unknown item \${itemId}\`);
	const bag = bags.get(player) ?? [];
	bag.push(itemId);
	bags.set(player, bag);
}`,
		},
	},
	{
		feature: { luau: "Shop", ts: "shop" },
		colour: "--agent-3",
		file: {
			luau: "ShopController@Client.luau",
			ts: "shop-controller@client.ts",
		},
		code: {
			luau: `local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ShopTypes = require(ReplicatedStorage.Shared.Shop.ShopTypes)

local ShopController = {}

function ShopController.open(offer: ShopTypes.Offer)
	local gui = Players.LocalPlayer.PlayerGui:WaitForChild("Shop")
	gui.Title.Text = offer.name
	gui.Price.Text = \`{offer.price} coins\`
	gui.Enabled = true
end

return ShopController`,
			ts: `import { Players } from "@rbxts/services";
import { Offer } from "./shop-types";

export function openShop(offer: Offer) {
	const gui = Players.LocalPlayer.FindFirstChild("PlayerGui")?.FindFirstChild("Shop");
	if (!gui?.IsA("ScreenGui")) return;
	gui.Enabled = true;
	print(\`\${offer.name}: \${offer.price} coins\`);
}`,
		},
	},
];

// What VS Code's Modern themes colour as keywords: storage in blue, control flow in purple.
const KEYWORDS: Record<Lang, Set<string>> = {
	luau: new Set([
		"local",
		"function",
		"and",
		"or",
		"not",
		"nil",
		"true",
		"false",
	]),
	ts: new Set(["const", "let", "function", "new", "true", "false"]),
};
const CONTROL: Record<Lang, Set<string>> = {
	luau: new Set([
		"if",
		"then",
		"else",
		"elseif",
		"end",
		"return",
		"for",
		"in",
		"do",
		"while",
	]),
	ts: new Set(["import", "from", "export", "return", "if", "else", "for"]),
};
const TOKEN =
	/(--[^\n]*|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"?|`(?:[^`\\]|\\.)*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|([\s\S])/g;

const escape = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A line of code as VS Code colours it, as markup; word wrap may break after a dot, a bracket or a colon, as VS Code's does. */
function highlight(line: string, lang: Lang) {
	let out = "";
	for (const m of line.matchAll(TOKEN)) {
		const [text, comment, string, number, word] = m;
		const span = (cls: string) =>
			`<span class="tk-${cls}">${escape(text)}</span>`;
		if (comment) out += span("com");
		else if (string) out += span("str");
		else if (number) out += span("num");
		else if (word) {
			const after = line.slice(m.index + text.length).trimStart();
			if (CONTROL[lang].has(word)) out += span("ctl");
			else if (KEYWORDS[lang].has(word)) out += span("kw");
			else if (after.startsWith("(") || after.startsWith("<"))
				out += span("fn");
			else out += span("var");
		} else out += escape(text) + (/[.(:]/.test(text) ? "<wbr>" : "");
	}
	return out;
}

/** The first typed characters of an agent's file, as numbered lines with the agent's cursor at the end. */
function render(k: number, lang: Lang, typed: number) {
	const lines = AGENTS[k].code[lang].slice(0, typed).split("\n");
	return lines
		.map(
			(line, i) =>
				`<li><i>${i + 1}</i><span>${highlight(line, lang)}${
					i === lines.length - 1
						? `<b class="caret"><em>Agent ${k + 1}</em></b>`
						: ""
				}</span></li>`
		)
		.join("");
}

// The same opening state on the server and the client, so hydration matches.
const opening = (k: number, lang: Lang) =>
	Math.floor(AGENTS[k].code[lang].length * (0.3 + k * 0.2));

/** Three VS Code windows, one per feature folder, each with an agent writing a file of that feature. */
export function AgentWindows() {
	const ref = useRef<HTMLDivElement>(null);
	const lang = useLang();

	useEffect(() => {
		const root = ref.current;
		if (!root) return;
		const typed = AGENTS.map((_, k) => opening(k, lang));
		const holds = AGENTS.map(() => 0);
		const codes = [...root.querySelectorAll<HTMLElement>(".ide-code")];
		const show = (k: number) => {
			codes[k].innerHTML = render(k, lang, typed[k]);
			codes[k].scrollTop = codes[k].scrollHeight;
		};
		// Each agent types at its own pace, waits at the end of a line and of the file, then starts again.
		const step = (k: number) => {
			const code = AGENTS[k].code[lang];
			if (holds[k] > 0) {
				holds[k]--;
				return;
			}
			if (typed[k] >= code.length) {
				typed[k] = 0;
				show(k);
				return;
			}
			typed[k] = Math.min(
				code.length,
				typed[k] + 1 + ((typed[k] * 7 + k) % 3)
			);
			if (code[typed[k] - 1] === "\n") holds[k] = 4;
			if (typed[k] >= code.length) holds[k] = 40;
			show(k);
		};
		const timers: number[] = [];
		const start = () =>
			AGENTS.forEach((_, k) => {
				clearInterval(timers[k]);
				timers[k] = window.setInterval(() => step(k), 55 + k * 15);
			});
		const stop = () => timers.forEach((t) => clearInterval(t));
		const io = new IntersectionObserver(([e]) =>
			e.isIntersecting ? start() : stop()
		);
		io.observe(root);
		return () => {
			io.disconnect();
			stop();
		};
	}, [lang]);

	return (
		<div
			ref={ref}
			className="agw ide rv"
			role="img"
			aria-label="Three VS Code windows, one for each feature folder: Combat, Inventory and Shop. A different agent writes a file of its own feature in each one at the same time."
		>
			{AGENTS.map((agent, k) => (
				<div
					key={k}
					className="aw"
					style={{ "--a": `var(${agent.colour})` } as CSSProperties}
					aria-hidden="true"
				>
					<VsCodeWindow title="my-game">
						<div className="ide-tabbar">
							<span className="ide-tab">
								<FileIcon name={agent.file[lang]} />
								{agent.file[lang]}
							</span>
						</div>
						<div className="ide-crumbs">
							src › {agent.feature[lang]} › {agent.file[lang]}
						</div>
						<ol
							className="ide-code"
							dangerouslySetInnerHTML={{
								__html: render(k, lang, opening(k, lang)),
							}}
						/>
						<div className="ide-status">
							<span className="aw-dot" />
							Agent {k + 1}
							<span className="aw-r">
								{lang === "ts" ? "TypeScript" : "Luau"}
							</span>
						</div>
					</VsCodeWindow>
				</div>
			))}
		</div>
	);
}
