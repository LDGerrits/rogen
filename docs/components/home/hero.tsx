"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Fragment } from "react";
import { FaFileCode, FaFolderOpen } from "react-icons/fa";
import { SiTypescript } from "react-icons/si";
import { InstallCommand } from "./install-command";
import { easeOutExpo } from "./reveal";

const routed: readonly (readonly [string, string, string])[] = [
	[
		"InventoryService@Server.luau",
		"ServerScriptService",
		"/Inventory/InventoryService",
	],
	[
		"InventoryController@Client.luau",
		"StarterPlayer",
		"/StarterPlayerScripts/Inventory/InventoryController",
	],
	["ItemCatalog.luau", "ReplicatedStorage", "/Shared/Inventory/ItemCatalog"],
];

function FileName({ name }: { name: string }) {
	const parts = /^(.+)(@\w+)(\.\w+)$/.exec(name);
	if (!parts) return name;
	return (
		<>
			{parts[1]}
			<span className="text-brand">{parts[2]}</span>
			{parts[3]}
		</>
	);
}

function Path({ path }: { path: string }) {
	return path.split("/").map((part, i) => (
		<Fragment key={i}>
			{i > 0 && (
				<>
					/<wbr />
				</>
			)}
			{part}
		</Fragment>
	));
}

function RouteList() {
	return (
		<div className="rounded-[4px] border border-rule bg-ink-raised font-mono text-[13px]">
			<div className="flex items-center gap-2.5 border-b border-rule px-5 py-3 text-stone-400">
				<FaFolderOpen className="text-stone-500" />
				src/Inventory
			</div>
			<ul>
				{routed.map(([file, service, rest]) => (
					<li
						key={file}
						className="border-b border-rule px-5 py-4 last:border-b-0 sm:whitespace-nowrap"
					>
						<div className="text-paper">
							<FileName name={file} />
						</div>
						<div className="mt-1 text-stone-500">
							<span className="select-none text-stone-600">
								→{" "}
							</span>
							<span className="text-stone-300">{service}</span>
							<Path path={rest} />
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}

export function Hero() {
	const reduced = useReducedMotion();
	const item = {
		hidden: reduced ? {} : { opacity: 0, y: 14 },
		visible: {
			opacity: 1,
			y: 0,
			transition: { duration: 0.7, ease: easeOutExpo },
		},
	};

	return (
		<section className="border-b border-rule px-6 pt-20 pb-20 md:pt-28 md:pb-24">
			<motion.div
				className="mx-auto w-full max-w-6xl"
				initial="hidden"
				animate="visible"
				transition={{ staggerChildren: 0.08 }}
			>
				<motion.p
					variants={item}
					className="text-lg font-medium text-stone-400 md:text-xl"
				>
					Rojo with file-system routing
				</motion.p>

				<motion.h1
					variants={item}
					className="mt-5 text-[clamp(3rem,7.4vw,7.25rem)] leading-[0.94] font-bold tracking-[-0.045em] text-paper"
				>
					Professional-grade
					<br className="hidden md:block" /> architecture for Roblox
				</motion.h1>

				<motion.div
					variants={item}
					className="mt-16 grid gap-12 border-t border-rule pt-12 md:mt-20 lg:grid-cols-12 lg:gap-8"
				>
					<div className="flex flex-col items-start gap-10 lg:col-span-5">
						<p className="max-w-[40ch] text-lg leading-relaxed text-stone-400">
							Rogen is a superset of Rojo that generates Rojo
							project files from your folders. You organize your
							game by feature, and Rogen puts each file in the
							right place.
						</p>
						<InstallCommand />
						<div className="flex items-center gap-5 text-sm text-stone-500">
							<span className="flex items-center gap-2">
								<FaFileCode />
								Luau
							</span>
							<span className="flex items-center gap-2">
								<SiTypescript />
								roblox-ts
							</span>
						</div>
					</div>

					<div className="min-w-0 lg:col-span-7 lg:col-start-6">
						<RouteList />
					</div>
				</motion.div>
			</motion.div>
		</section>
	);
}
