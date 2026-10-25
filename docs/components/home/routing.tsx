"use client";

import Link from "next/link";
import { useState } from "react";
import type { IconType } from "react-icons";
import {
	FaBox,
	FaCube,
	FaFileAlt,
	FaFileCode,
	FaFolder,
	FaFolderOpen,
	FaServer,
	FaTerminal,
	FaUser,
} from "react-icons/fa";
import { SiRoblox } from "react-icons/si";
import { Reveal } from "./reveal";

type ViewState = "suffixes" | "folders";

interface Row {
	readonly name: string;
	readonly level: number;
	readonly kind:
		| "root"
		| "feature"
		| "routing"
		| "subfolder"
		| "script"
		| "asset"
		| "replicated"
		| "server"
		| "player"
		| "folder"
		| "instance";
	readonly mt?: boolean;
}

const rowStyles: Record<
	Row["kind"],
	{ icon: IconType; iconClass: string; textClass?: string }
> = {
	root: { icon: FaFolder, iconClass: "text-stone-600" },
	feature: {
		icon: FaFolderOpen,
		iconClass: "text-paper",
		textClass: "text-paper font-medium",
	},
	routing: {
		icon: FaFolder,
		iconClass: "text-brand/70",
		textClass: "text-brand",
	},
	subfolder: {
		icon: FaFolder,
		iconClass: "text-stone-500",
		textClass: "text-stone-300",
	},
	script: { icon: FaFileCode, iconClass: "text-stone-500" },
	asset: { icon: FaCube, iconClass: "text-stone-500" },
	replicated: { icon: FaBox, iconClass: "text-stone-600" },
	server: { icon: FaServer, iconClass: "text-stone-600" },
	player: { icon: FaUser, iconClass: "text-stone-600" },
	folder: {
		icon: FaFolder,
		iconClass: "text-paper",
		textClass: "text-paper font-medium",
	},
	instance: { icon: FaFileAlt, iconClass: "text-stone-500" },
};

const routes: readonly (readonly [string, string])[] = [
	["Server", "ServerScriptService"],
	["Client", "StarterPlayer/StarterPlayerScripts"],
	["Shared", "ReplicatedStorage/Shared"],
	["*", "ReplicatedStorage/Shared"],
];

/** Instances under one service; a path such as `UI/ItemSlot` nests in a folder. */
function instances(paths: readonly string[], level: number): Row[] {
	const rows: Row[] = [];
	const folders = new Set<string>();
	for (const path of paths) {
		const [folder, name] = path.split("/");
		if (name === undefined) {
			rows.push({ name: folder, level, kind: "instance" });
			continue;
		}
		if (!folders.has(folder)) {
			folders.add(folder);
			rows.push({ name: folder, level, kind: "subfolder" });
		}
		rows.push({ name, level: level + 1, kind: "instance" });
	}
	return rows;
}

const studio: Row[] = [
	{ name: "ReplicatedStorage", level: 0, kind: "replicated" },
	{ name: "Shared", level: 1, kind: "folder" },
	{ name: "Inventory", level: 2, kind: "folder" },
	...instances(
		[
			"InventoryTypes",
			"ItemCatalog",
			"ItemIcons",
			"UI/InventoryHud",
			"UI/ItemSlot",
		],
		3
	),
	{ name: "ServerScriptService", level: 0, kind: "server", mt: true },
	{ name: "Inventory", level: 1, kind: "folder" },
	...instances(["InventoryService", "InventoryStore"], 2),
	{ name: "StarterPlayer", level: 0, kind: "player", mt: true },
	{ name: "StarterPlayerScripts", level: 1, kind: "player" },
	{ name: "Inventory", level: 2, kind: "folder" },
	...instances(["InventoryController", "InventoryInput"], 3),
];

const views: Record<ViewState, { label: string; desc: string; disk: Row[] }> = {
	suffixes: {
		label: "Route by name",
		desc: "Mark only the files that belong on one side. Everything else goes to ReplicatedStorage through the * route.",
		disk: [
			{ name: "src", level: 0, kind: "root" },
			{ name: "Inventory", level: 1, kind: "feature" },
			{ name: "UI", level: 2, kind: "subfolder" },
			{ name: "InventoryHud.luau", level: 3, kind: "script" },
			{ name: "ItemSlot.luau", level: 3, kind: "script" },
			{
				name: "InventoryController@Client.luau",
				level: 2,
				kind: "script",
			},
			{ name: "InventoryInput@Client.luau", level: 2, kind: "script" },
			{ name: "InventoryService@Server.luau", level: 2, kind: "script" },
			{ name: "InventoryStore@Server.luau", level: 2, kind: "script" },
			{ name: "InventoryTypes.luau", level: 2, kind: "script" },
			{ name: "ItemCatalog.luau", level: 2, kind: "script" },
			{ name: "ItemIcons.rbxm", level: 2, kind: "asset" },
		],
	},
	folders: {
		label: "Route by folder",
		desc: "Put files in a Client or Server folder. In Studio, that folder disappears and its files sit directly in the feature's folder.",
		disk: [
			{ name: "src", level: 0, kind: "root" },
			{ name: "Inventory", level: 1, kind: "feature" },
			{ name: "UI", level: 2, kind: "subfolder" },
			{ name: "InventoryHud.luau", level: 3, kind: "script" },
			{ name: "ItemSlot.luau", level: 3, kind: "script" },
			{ name: "Client", level: 2, kind: "routing" },
			{ name: "InventoryController.luau", level: 3, kind: "script" },
			{ name: "InventoryInput.luau", level: 3, kind: "script" },
			{ name: "Server", level: 2, kind: "routing" },
			{ name: "InventoryService.luau", level: 3, kind: "script" },
			{ name: "InventoryStore.luau", level: 3, kind: "script" },
			{ name: "InventoryTypes.luau", level: 2, kind: "script" },
			{ name: "ItemCatalog.luau", level: 2, kind: "script" },
			{ name: "ItemIcons.rbxm", level: 2, kind: "asset" },
		],
	},
};

function Name({ row, className }: { row: Row; className?: string }) {
	const parts =
		row.kind === "script" ? /^(.+)(@\w+)(\.\w+)$/.exec(row.name) : null;
	if (!parts) return <span className={className}>{row.name}</span>;
	return (
		<span className={className}>
			{parts[1]}
			<span className="text-brand">{parts[2]}</span>
			{parts[3]}
		</span>
	);
}

function Tree({ rows }: { rows: Row[] }) {
	return (
		<>
			{rows.map((row, i) => {
				const style = rowStyles[row.kind];
				const Icon = style.icon;
				return (
					<div
						key={i}
						className={`flex items-center gap-2.5 ${row.mt ? "mt-3" : ""}`}
						style={{ marginLeft: `${row.level * 18}px` }}
					>
						<Icon className={`shrink-0 ${style.iconClass}`} />
						<Name row={row} className={style.textClass} />
					</div>
				);
			})}
		</>
	);
}

function Panel({
	icon: Icon,
	title,
	rows,
}: {
	icon: IconType;
	title: string;
	rows: Row[];
}) {
	return (
		<div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-ink">
			<div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3.5">
				<Icon className="text-sm text-stone-500" />
				<span className="font-mono text-[11px] uppercase tracking-[0.16em] text-stone-500">
					{title}
				</span>
			</div>
			<div className="overflow-x-auto whitespace-nowrap p-6 font-mono text-[13px] leading-7 text-stone-400">
				<Tree rows={rows} />
			</div>
		</div>
	);
}

function Config() {
	return (
		<div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-ink">
			<div className="border-b border-white/[0.06] px-5 py-3.5 font-mono text-[11px] uppercase tracking-[0.16em] text-stone-500">
				default.rogen.json
			</div>
			<pre className="overflow-x-auto p-6 font-mono text-[12.5px] leading-6 text-stone-500">
				{"{\n"}
				{'  "name": '}
				<span className="text-stone-300">&quot;Game&quot;</span>
				{",\n"}
				{'  "routes": {\n'}
				{routes.map(([key, target], i) => (
					<span key={key}>
						{"    "}
						<span className="text-brand">&quot;{key}&quot;</span>
						{": "}
						<span className="text-stone-300">
							&quot;{target}&quot;
						</span>
						{i < routes.length - 1 ? ",\n" : "\n"}
					</span>
				))}
				{"  },\n"}
				{'  "tree": { "$className": '}
				<span className="text-stone-300">&quot;DataModel&quot;</span>
				{" }\n}"}
			</pre>
		</div>
	);
}

export function Routing() {
	const [activeView, setActiveView] = useState<ViewState>("suffixes");
	const view = views[activeView];

	return (
		<section
			id="routing"
			className="relative border-y border-white/[0.06] bg-ink-raised px-6 py-24 lg:py-32"
		>
			<div className="mx-auto max-w-6xl">
				<div className="mb-14 grid gap-10 lg:grid-cols-12 lg:items-center">
					<Reveal className="flex min-w-0 flex-col items-start text-left lg:col-span-5">
						<h2 className="text-3xl font-semibold tracking-[-0.03em] text-paper md:text-5xl">
							How routing works
						</h2>
						<p className="mt-5 max-w-md text-lg leading-relaxed text-stone-400">
							You choose the routes and where each one points. Add{" "}
							<code className="font-mono text-[0.9em] text-brand">
								@Server
							</code>{" "}
							to a file&apos;s name or put it in a{" "}
							<code className="font-mono text-[0.9em] text-brand">
								Server
							</code>{" "}
							folder, and it goes to ServerScriptService. Files
							without a route go to{" "}
							<code className="font-mono text-[0.9em] text-brand">
								*
							</code>
							.
						</p>
					</Reveal>
					<Reveal
						className="min-w-0 lg:col-span-6 lg:col-start-7"
						delay={0.08}
					>
						<Config />
						<p className="mt-4 text-sm leading-relaxed text-stone-500">
							Add your own, such as{" "}
							<code className="font-mono text-[0.9em] text-stone-300">
								&quot;Gui&quot;: &quot;StarterGui&quot;
							</code>
							, and{" "}
							<code className="font-mono text-[0.9em] text-brand">
								@Gui
							</code>{" "}
							sends a file to StarterGui.
						</p>
					</Reveal>
				</div>

				<Reveal>
					<div className="mb-5 inline-flex flex-wrap gap-1 rounded-full border border-white/[0.07] bg-ink p-1">
						{(Object.keys(views) as ViewState[]).map((id) => (
							<button
								key={id}
								onClick={() => setActiveView(id)}
								className={`rounded-full px-5 py-2.5 text-sm font-medium transition-colors duration-300 ${
									activeView === id
										? "bg-paper text-ink"
										: "text-stone-500 hover:text-paper"
								}`}
							>
								{views[id].label}
							</button>
						))}
					</div>

					<p className="mb-8 max-w-3xl text-[15px] leading-relaxed text-stone-400">
						{view.desc}
					</p>

					<div className="flex flex-col items-stretch gap-3 md:flex-row md:gap-0">
						<Panel
							icon={FaTerminal}
							title="File system"
							rows={view.disk}
						/>
						<div className="flex items-center justify-center text-stone-600 md:px-5">
							<span className="rotate-90 font-mono text-lg md:rotate-0">
								→
							</span>
						</div>
						<Panel
							icon={SiRoblox}
							title="Roblox Studio"
							rows={studio}
						/>
					</div>

					<Link
						href="/docs/v2/core-concepts/routing"
						className="group mt-10 inline-flex items-center gap-1.5 text-sm font-medium text-stone-400 transition-colors duration-300 hover:text-paper"
					>
						Read the routing guide
						<span className="transition-transform duration-500 ease-out-expo group-hover:translate-x-1">
							→
						</span>
					</Link>
				</Reveal>
			</div>
		</section>
	);
}
