import Link from "next/link";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import { FaCube, FaFileCode, FaFolder, FaFolderOpen } from "react-icons/fa";
import { Reveal } from "./reveal";

const rojoCommands: readonly (readonly [string, string])[] = [
	["serve", ""],
	["build", "-o game.rbxl"],
	["sourcemap", "-o sourcemap.json"],
	["syncback", "--input game.rbxl"],
];

type TreeKind = "feature" | "open" | "folder" | "file" | "asset";

const featureTree: { name: string; level: number; kind: TreeKind }[] = [
	{ name: "Combat", level: 0, kind: "feature" },
	{ name: "Inventory", level: 0, kind: "open" },
	{ name: "UI", level: 1, kind: "folder" },
	{ name: "InventoryHud.luau", level: 2, kind: "file" },
	{ name: "ItemSlot.luau", level: 2, kind: "file" },
	{ name: "InventoryController@Client.luau", level: 1, kind: "file" },
	{ name: "InventoryService@Server.luau", level: 1, kind: "file" },
	{ name: "InventoryTypes.luau", level: 1, kind: "file" },
	{ name: "ItemIcons.rbxm", level: 1, kind: "asset" },
	{ name: "Shop", level: 0, kind: "feature" },
];

const treeStyles: Record<
	TreeKind,
	{ icon: IconType; iconClass: string; textClass: string }
> = {
	feature: { icon: FaFolder, iconClass: "text-stone-600", textClass: "" },
	open: {
		icon: FaFolderOpen,
		iconClass: "text-paper",
		textClass: "text-paper",
	},
	folder: {
		icon: FaFolder,
		iconClass: "text-stone-500",
		textClass: "text-stone-300",
	},
	file: {
		icon: FaFileCode,
		iconClass: "text-stone-500",
		textClass: "text-stone-400",
	},
	asset: {
		icon: FaCube,
		iconClass: "text-stone-500",
		textClass: "text-stone-400",
	},
};

function TreeName({ name }: { name: string }) {
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

function CardLink({ href, children }: { href: string; children: string }) {
	return (
		<Link
			href={href}
			className="group mt-8 inline-flex items-center gap-1.5 self-start text-sm font-medium text-stone-300 underline decoration-transparent underline-offset-4 transition-colors duration-200 hover:text-paper hover:decoration-stone-500"
		>
			{children}
			<span className="transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5">
				→
			</span>
		</Link>
	);
}

function Cell({
	title,
	children,
	link,
}: {
	title: string;
	children: ReactNode;
	link: ReactNode;
}) {
	return (
		<div className="flex flex-col bg-ink p-8 md:p-10">
			<h3 className="text-xl font-semibold tracking-[-0.02em] text-paper md:text-2xl">
				{title}
			</h3>
			<div className="mt-3 grow text-[15px] leading-relaxed text-stone-400">
				{children}
			</div>
			{link}
		</div>
	);
}

export function Features() {
	return (
		<section id="features" className="px-6 py-24 lg:py-32">
			<div className="mx-auto max-w-6xl">
				<Reveal className="mb-14 flex flex-col items-end text-right lg:mb-20">
					<p className="mb-4 font-medium text-stone-500">
						Why Rogen?
					</p>
					<h2 className="max-w-[16ch] text-4xl leading-[1] font-bold tracking-[-0.04em] text-paper md:text-6xl">
						One folder per feature, from server to client
					</h2>
				</Reveal>

				<Reveal>
					<div className="grid gap-px overflow-hidden rounded-[4px] border border-rule bg-rule lg:grid-cols-3">
						<div className="grid gap-px bg-rule md:grid-cols-12 lg:col-span-3">
							<div className="flex flex-col bg-ink p-8 md:col-span-5 md:p-10">
								<h3 className="text-2xl font-semibold tracking-[-0.025em] text-paper md:text-3xl">
									Organize by feature
								</h3>
								<p className="mt-4 grow leading-relaxed text-stone-400">
									Keep everything a feature needs in one
									folder, from its server code to its UI and
									assets. You find it all in one place, and
									you remove a feature by deleting its folder.
								</p>
								<CardLink href="/docs/v2/architectures">
									See suggested architectures
								</CardLink>
							</div>
							<div className="overflow-x-auto bg-ink-raised p-8 font-mono text-[13px] leading-8 text-stone-500 md:col-span-7 md:p-10">
								<div className="mb-1 text-stone-600">src/</div>
								{featureTree.map((row) => {
									const style = treeStyles[row.kind];
									const Icon = style.icon;
									return (
										<div
											key={`${row.level}-${row.name}`}
											className="flex items-center gap-2.5 whitespace-nowrap"
											style={{
												paddingLeft: `${row.level * 20}px`,
											}}
										>
											<Icon
												className={`shrink-0 ${style.iconClass}`}
											/>
											<span className={style.textClass}>
												<TreeName name={row.name} />
											</span>
										</div>
									);
								})}
							</div>
						</div>

						<Cell
							title="Enforce boundaries"
							link={
								<CardLink href="/docs/v2/architectures#enforcing-the-rules">
									See the lint rule
								</CardLink>
							}
						>
							Every require path includes the name of its feature,
							so a lint rule can stop one feature from reaching
							into another.
						</Cell>

						<Cell
							title="Multi-place games"
							link={
								<CardLink href="/docs/v2/setups/places">
									Set up places
								</CardLink>
							}
						>
							Write shared code once and use it in every place.
							When one place needs its own version of a file, put
							a file with the same name in that place&apos;s
							folder, and it replaces the shared one.
						</Cell>

						<Cell
							title="Still Rojo"
							link={
								<CardLink href="/docs/v2/coming-from-rojo">
									Coming from Rojo
								</CardLink>
							}
						>
							<p>
								Run{" "}
								<code className="font-mono text-[0.9em] whitespace-nowrap text-stone-300">
									rogen serve
								</code>{" "}
								where you ran{" "}
								<code className="font-mono text-[0.9em] whitespace-nowrap text-stone-300">
									rojo serve
								</code>
								, with the same flags. Rojo still does the
								syncing and building underneath.
							</p>
							<pre className="mt-6 overflow-x-auto border-l border-rule pl-4 font-mono text-[12.5px] leading-7">
								{rojoCommands.map(([verb, flags]) => (
									<div key={verb}>
										<span className="text-stone-500">
											rogen
										</span>{" "}
										<span className="text-paper">
											{verb}
										</span>
										{flags && (
											<span className="text-stone-500">
												{" "}
												{flags}
											</span>
										)}
									</div>
								))}
							</pre>
						</Cell>
					</div>
				</Reveal>
			</div>
		</section>
	);
}
