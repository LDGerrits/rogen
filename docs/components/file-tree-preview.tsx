import { ReactNode } from "react";
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

export function PreviewGroup({ children }: { children: ReactNode }) {
	return (
		<div className="w-full flex flex-col md:flex-row items-stretch justify-start gap-4 my-8 relative text-left not-prose">
			{children}
		</div>
	);
}

export function PreviewArrow() {
	return (
		<div className="flex items-center justify-center z-20 py-4 md:py-0 px-2 md:px-6">
			<svg
				className="text-stone-500 md:rotate-0 rotate-90"
				fill="none"
				height="32"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1"
				viewBox="0 0 24 24"
				width="32"
			>
				<path d="M5 12h14"></path>
				<path d="M12 5l7 7-7 7"></path>
			</svg>
		</div>
	);
}

export function SystemWindow({ children }: { children: ReactNode }) {
	return (
		<div className="flex-1 bg-ink rounded-2xl border border-white/[0.07] overflow-hidden flex flex-col">
			<div className="bg-ink-raised px-5 py-3.5 flex items-center gap-3 border-b border-white/[0.06]">
				<FaTerminal className="text-stone-500 text-sm" />
				<span className="text-[11px] font-mono text-stone-500 tracking-[0.16em] uppercase">
					File System
				</span>
			</div>
			<div className="p-6 font-mono text-sm leading-8 text-stone-400 whitespace-nowrap overflow-x-auto min-h-30">
				{children}
			</div>
		</div>
	);
}

export function StudioWindow({ children }: { children: ReactNode }) {
	return (
		<div className="flex-1 bg-ink rounded-2xl border border-white/[0.07] overflow-hidden flex flex-col">
			<div className="bg-ink-raised px-5 py-3.5 flex items-center gap-3 border-b border-white/[0.06]">
				<SiRoblox className="text-stone-400 text-sm" />
				<span className="text-[11px] font-mono text-stone-500 tracking-[0.16em] uppercase">
					Roblox Studio
				</span>
			</div>
			<div className="p-6 font-mono text-sm leading-8 text-stone-400 whitespace-nowrap overflow-x-auto min-h-30">
				{children}
			</div>
		</div>
	);
}

export function TreeFolder({
	name,
	level = 0,
	open = false,
	highlight = false,
	dim = false,
}: {
	name: string;
	level?: number;
	open?: boolean;
	highlight?: boolean;
	dim?: boolean;
}) {
	return (
		<div
			className={`flex items-center gap-2 ${dim ? "opacity-50" : ""}`}
			style={{ marginLeft: `${level * 16}px` }}
		>
			{open ? (
				<FaFolderOpen className="text-paper" />
			) : (
				<FaFolder className="text-stone-600" />
			)}
			<span className={highlight ? "text-paper font-medium" : ""}>
				{name}
			</span>
		</div>
	);
}

export function TreeFile({
	name,
	level = 0,
	marker = false,
}: {
	name: string;
	level?: number;
	marker?: boolean;
}) {
	return (
		<div
			className={`flex items-center gap-2`}
			style={{ marginLeft: `${level * 16}px` }}
		>
			{marker ? (
				<FaFileAlt className="text-stone-500" />
			) : (
				<FaFileCode className="text-paper" />
			)}
			<span className={marker ? "text-stone-400" : "text-stone-300"}>
				{name}
			</span>
		</div>
	);
}

export function TreeService({
	name,
	type,
	level = 0,
	mt = false,
}: {
	name: string;
	type: "replicated" | "server" | "player";
	level?: number;
	mt?: boolean;
}) {
	let Icon = FaBox;
	if (type === "server") Icon = FaServer;
	if (type === "player") Icon = FaUser;

	return (
		<div
			className={`flex items-center gap-2 ${mt ? "mt-3" : ""}`}
			style={{ marginLeft: `${level * 16}px` }}
		>
			<Icon className="text-stone-600" />
			<span>{name}</span>
		</div>
	);
}

export function StudioFile({
	name,
	level = 0,
}: {
	name: string;
	level?: number;
}) {
	return (
		<div
			className={`flex items-center gap-2`}
			style={{ marginLeft: `${level * 16}px` }}
		>
			<FaFileAlt className="text-stone-400" />
			<span className="text-stone-400">{name}</span>
		</div>
	);
}
