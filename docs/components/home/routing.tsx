"use client";

import Link from "next/link";
import { Reveal } from "./reveal";
import { useState } from "react";
import type { IconType } from "react-icons";
import {
	FaFolderOpen,
	FaFileCode,
	FaFolder,
	FaBox,
	FaServer,
	FaFileAlt,
	FaTerminal,
	FaUser,
} from "react-icons/fa";
import { SiRoblox } from "react-icons/si";

type ViewState = "folders" | "at" | "markers";

interface Row {
	readonly name: string;
	readonly level: number;
	readonly kind:
		| "root"
		| "feature"
		| "routing"
		| "script"
		| "marker"
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
	script: { icon: FaFileCode, iconClass: "text-stone-400" },
	marker: {
		icon: FaFileAlt,
		iconClass: "text-brand/70",
		textClass: "text-brand",
	},
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

function studioTree(
	feature: string,
	shared: string[],
	server: string[],
	client: string[]
): Row[] {
	const rows: Row[] = [];
	if (shared.length > 0) {
		rows.push(
			{ name: "ReplicatedStorage", level: 0, kind: "replicated" },
			{ name: "Shared", level: 1, kind: "folder" },
			{ name: feature, level: 2, kind: "folder" },
			...shared.map((name): Row => ({ name, level: 3, kind: "instance" }))
		);
	}
	if (server.length > 0) {
		rows.push(
			{
				name: "ServerScriptService",
				level: 0,
				kind: "server",
				mt: rows.length > 0,
			},
			{ name: feature, level: 1, kind: "folder" },
			...server.map((name): Row => ({ name, level: 2, kind: "instance" }))
		);
	}
	if (client.length > 0) {
		rows.push(
			{
				name: "StarterPlayer",
				level: 0,
				kind: "player",
				mt: rows.length > 0,
			},
			{ name: "StarterPlayerScripts", level: 1, kind: "player" },
			{ name: feature, level: 2, kind: "folder" },
			...client.map((name): Row => ({ name, level: 3, kind: "instance" }))
		);
	}
	return rows;
}

const views: Record<
	ViewState,
	{ label: string; desc: string; disk: Row[]; studio: Row[] }
> = {
	folders: {
		label: "Routing Folders",
		desc: "Name a folder after a route, and everything inside goes to its target. The folder itself disappears.",
		disk: [
			{ name: "src", level: 0, kind: "root" },
			{ name: "Inventory", level: 1, kind: "feature" },
			{ name: "Client", level: 2, kind: "routing" },
			{ name: "InventoryController.luau", level: 3, kind: "script" },
			{ name: "Server", level: 2, kind: "routing" },
			{ name: "InventoryService.luau", level: 3, kind: "script" },
			{ name: "Shared", level: 2, kind: "routing" },
			{ name: "InventoryTypes.luau", level: 3, kind: "script" },
		],
		studio: studioTree(
			"Inventory",
			["InventoryTypes"],
			["InventoryService"],
			["InventoryController"]
		),
	},
	at: {
		label: "The @ Sign",
		desc: "Add @ and a route to a file's name to send just that file. A module stays a module.",
		disk: [
			{ name: "src", level: 0, kind: "root" },
			{ name: "Combat", level: 1, kind: "feature" },
			{ name: "CombatController@Client.luau", level: 2, kind: "script" },
			{ name: "CombatService@Server.luau", level: 2, kind: "script" },
			{ name: "CombatTypes.luau", level: 2, kind: "script" },
		],
		studio: studioTree(
			"Combat",
			["CombatTypes"],
			["CombatService"],
			["CombatController"]
		),
	},
	markers: {
		label: "Marker Files",
		desc: "Add a file named @ and a route, such as @Server, to a folder, and the whole folder goes there under its own name.",
		disk: [
			{ name: "src", level: 0, kind: "root" },
			{ name: "AntiCheat", level: 1, kind: "feature" },
			{ name: "@Server", level: 2, kind: "marker" },
			{ name: "AntiCheatService.luau", level: 2, kind: "script" },
			{ name: "Monitor.luau", level: 2, kind: "script" },
		],
		studio: studioTree(
			"AntiCheat",
			[],
			["AntiCheatService", "Monitor"],
			[]
		),
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
						<Icon className={style.iconClass} />
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
			<div className="min-h-80 overflow-x-auto whitespace-nowrap p-6 font-mono text-[13px] leading-8 text-stone-400">
				<Tree rows={rows} />
			</div>
		</div>
	);
}

export function Routing() {
	const [activeView, setActiveView] = useState<ViewState>("folders");
	const view = views[activeView];

	return (
		<section
			id="routing"
			className="relative border-y border-white/[0.06] bg-ink-raised px-6 py-24 lg:py-32"
		>
			<div className="mx-auto max-w-6xl">
				<Reveal className="mb-12 flex flex-col items-start text-left">
					<h2 className="text-3xl font-semibold tracking-[-0.03em] text-paper md:text-5xl">
						How routing works
					</h2>
					<p className="mt-5 max-w-xl text-lg leading-relaxed text-stone-400">
						Declare routes such as{" "}
						<code className="font-mono text-[0.9em] text-stone-200">
							Server
						</code>{" "}
						and{" "}
						<code className="font-mono text-[0.9em] text-stone-200">
							Client
						</code>{" "}
						in{" "}
						<code className="font-mono text-[0.9em] text-stone-200">
							default.rogen.json
						</code>
						, then name a folder or a file after one.
					</p>
				</Reveal>

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

					<p className="mb-8 min-h-12 max-w-2xl text-[15px] leading-relaxed text-stone-400">
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
							rows={view.studio}
						/>
					</div>

					<Link
						href="/docs/v2/core-concepts/routing"
						className="group mt-10 inline-flex items-center gap-1.5 text-sm font-medium text-stone-400 transition-colors duration-300 hover:text-paper"
					>
						Read how routing works
						<span className="transition-transform duration-500 ease-out-expo group-hover:translate-x-1">
							→
						</span>
					</Link>
				</Reveal>
			</div>
		</section>
	);
}
