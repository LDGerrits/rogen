"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { useLang } from "./lang";

const AGENTS = [
	{
		feature: "Combat",
		colour: "--agent-1",
		files: {
			luau: [
				"CombatService@Server.luau",
				"CombatController@Client.luau",
				"CombatTypes.luau",
			],
			ts: [
				"combatService@server.ts",
				"combatController@client.ts",
				"combatTypes.ts",
			],
		},
	},
	{
		feature: "Inventory",
		colour: "--agent-2",
		files: {
			luau: [
				"InventoryService@Server.luau",
				"InventoryHud.luau",
				"ItemCatalog.luau",
			],
			ts: [
				"inventoryService@server.ts",
				"InventoryHud.tsx",
				"itemCatalog.ts",
			],
		},
	},
	{
		feature: "Shop",
		colour: "--agent-3",
		files: {
			luau: [
				"ShopService@Server.luau",
				"ShopController@Client.luau",
				"ShopTypes.luau",
			],
			ts: [
				"shopService@server.ts",
				"shopController@client.ts",
				"shopTypes.ts",
			],
		},
	},
];
// The file name, with its @Server or @Client suffix in that route's colour.
const fileName = (name: string) => {
	const at = name.indexOf("@");
	if (at < 0) return name;
	const dot = name.lastIndexOf(".");
	const route = /@server/i.test(name) ? "s" : "c";
	return `${name.slice(0, at)}<span class="c-${route}">${name.slice(at, dot)}</span>${name.slice(dot)}`;
};
const ROWS = 10;
const FILE_LINES = 16;
const WORDS = ["====", "======", "==", "========", "---", "-----", "+++", "::"];

// One agent's editor: the lines of the file it is writing, and which file that is.
interface Editor {
	lines: string[];
	file: number;
	seed: number;
}

const rand = (e: Editor) =>
	(e.seed = (e.seed * 16807) % 2147483647) / 2147483647;

// Adds a word to the current line, or starts a new one; a full file moves on to the next.
function write(e: Editor, k: number) {
	const L = e.lines;
	if (!L.length || rand(e) < 0.16) {
		if (L.length >= FILE_LINES) {
			e.lines = [];
			e.file = (e.file + 1) % AGENTS[k].files.luau.length;
		}
		e.lines.push("  ".repeat(Math.floor(rand(e) * 3)));
		return;
	}
	const i = L.length - 1;
	if (L[i].trim().length > 18 + k * 3) L.push("");
	else
		L[i] +=
			(L[i].trim() ? " " : "") +
			WORDS[Math.floor(rand(e) * WORDS.length)];
}

// The same opening state on the server and the client, so hydration matches.
const opening = (k: number) => {
	const e: Editor = { lines: [], file: k % 3, seed: 11 + k * 7 };
	for (let n = 0; n < 34 + k * 9; n++) write(e, k);
	return e;
};

const visible = (e: Editor) => {
	const from = Math.max(0, e.lines.length - ROWS);
	return e.lines.slice(from).map((text, i) => ({ n: from + i + 1, text }));
};

function Lines({ e }: { e: Editor }) {
	const rows = visible(e);
	return rows.map(({ n, text }, i) => (
		<li key={n} className={i === rows.length - 1 ? "now" : undefined}>
			<i>{n}</i>
			<span>{text}</span>
		</li>
	));
}

/** Three editor windows, one per feature folder, each with an agent writing in it. */
export function AgentWindows() {
	const ref = useRef<HTMLDivElement>(null);
	const lang = useLang();

	useEffect(() => {
		const root = ref.current;
		if (!root) return;
		const editors = AGENTS.map((_, k) => opening(k));
		const wins = [...root.querySelectorAll<HTMLElement>(".aw")];
		const render = (k: number) => {
			const e = editors[k];
			const rows = visible(e);
			wins[k].querySelector("ol")!.innerHTML = rows
				.map(
					({ n, text }, i) =>
						`<li${i === rows.length - 1 ? ' class="now"' : ""}><i>${n}</i><span>${text}</span></li>`
				)
				.join("");
			const file = wins[k].querySelector<HTMLElement>("[data-file]")!;
			if (file.dataset.file !== String(e.file)) {
				file.dataset.file = String(e.file);
				file.innerHTML = fileName(AGENTS[k].files[lang][e.file]);
			}
		};

		// Each agent types at its own pace, and only while the windows are on screen.
		const timers: number[] = [];
		const start = () =>
			AGENTS.forEach((_, k) => {
				clearInterval(timers[k]);
				timers[k] = window.setInterval(
					() => {
						write(editors[k], k);
						render(k);
					},
					120 + k * 25
				);
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
			className="agw rv"
			role="img"
			aria-label="Three editor windows, one for each feature folder: Combat, Inventory and Shop. A different agent writes in each one at the same time."
		>
			{AGENTS.map((agent, k) => {
				const e = opening(k);
				return (
					<div
						key={agent.feature}
						className="aw"
						style={
							{ "--a": `var(${agent.colour})` } as CSSProperties
						}
						aria-hidden="true"
					>
						<div className="aw-bar">
							<span className="dots">
								<i />
								<i />
								<i />
							</span>
							<span className="aw-path">
								src/
								<b>
									{lang === "ts"
										? agent.feature.toLowerCase()
										: agent.feature}
								</b>
								/
							</span>
							<span className="aw-who">agent {k + 1}</span>
						</div>
						<ol className="aw-body">
							<Lines e={e} />
						</ol>
						<div className="aw-status">
							<span className="aw-dot" />
							<span
								data-file={e.file}
								dangerouslySetInnerHTML={{
									__html: fileName(agent.files[lang][e.file]),
								}}
							/>
							<span className="aw-r">writing</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}
