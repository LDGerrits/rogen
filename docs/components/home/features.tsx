import Link from "next/link";
import type { IconType } from "react-icons";
import { FaCube, FaFileCode, FaFolder, FaFolderOpen } from "react-icons/fa";
import { Reveal } from "./reveal";

const rojoVerbs = [
	"serve",
	"build",
	"sourcemap",
	"upload",
	"syncback",
	"plugin",
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
			className="group mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-stone-400 transition-colors duration-300 hover:text-paper"
		>
			{children}
			<span className="transition-transform duration-500 ease-out-expo group-hover:translate-x-1">
				→
			</span>
		</Link>
	);
}

function Index({ n }: { n: string }) {
	return (
		<span className="font-mono text-xs tracking-[0.14em] text-stone-600">
			{n}
		</span>
	);
}

export function Features() {
	return (
		<section id="features" className="relative px-6 py-24 lg:py-32">
			<div className="mx-auto max-w-6xl">
				<Reveal className="mb-14 flex flex-col items-end text-right lg:mb-20">
					<p className="mb-5 font-mono text-xs uppercase tracking-[0.18em] text-stone-500">
						Why Rogen?
					</p>
					<h2 className="max-w-[16ch] text-4xl font-semibold leading-[1.02] tracking-[-0.035em] text-paper md:text-6xl">
						One folder per feature, from server to client
					</h2>
				</Reveal>

				<div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
					<Reveal className="lg:col-span-2 lg:row-span-2">
						<div className="surface flex h-full flex-col overflow-hidden rounded-3xl md:flex-row">
							<div className="flex flex-col p-8 md:w-1/2 md:p-10">
								<Index n="01" />
								<h3 className="mt-6 text-2xl font-semibold tracking-[-0.02em] text-paper md:text-3xl">
									Organize by feature
								</h3>
								<p className="mt-4 grow leading-relaxed text-stone-400">
									Group all code, UI, and assets for a
									specific feature in one place. This gives
									you high cohesion, better scalability, fewer
									merge conflicts, and features that are
									simple to maintain or delete.
								</p>
								<CardLink href="/docs/v2/architectures">
									Compare architectures
								</CardLink>
							</div>
							<div className="border-t border-white/[0.06] bg-ink/60 p-8 font-mono text-[13px] leading-8 text-stone-500 md:w-1/2 md:border-t-0 md:border-l md:p-10">
								<div className="mb-2 text-stone-600">src/</div>
								{featureTree.map((row) => {
									const style = treeStyles[row.kind];
									const Icon = style.icon;
									return (
										<div
											key={`${row.level}-${row.name}`}
											className="flex items-center gap-2 whitespace-nowrap"
											style={{
												paddingLeft: `${row.level * 18}px`,
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
					</Reveal>

					<Reveal delay={0.08}>
						<div className="surface surface-interactive flex h-full flex-col rounded-3xl p-8">
							<Index n="02" />
							<h3 className="mt-6 text-xl font-semibold tracking-[-0.02em] text-paper">
								Enforce boundaries
							</h3>
							<p className="mt-3 grow text-[15px] leading-relaxed text-stone-400">
								Keep coupling low with a linter. Every path
								names its feature, so a lint rule can stop one
								feature from requiring another.
							</p>
							<CardLink href="/docs/v2/architectures#enforcing-the-rules">
								See the lint rule
							</CardLink>
						</div>
					</Reveal>

					<Reveal delay={0.16}>
						<div className="surface surface-interactive flex h-full flex-col rounded-3xl p-8">
							<Index n="03" />
							<h3 className="mt-6 text-xl font-semibold tracking-[-0.02em] text-paper">
								Multi-place games
							</h3>
							<p className="mt-3 grow text-[15px] leading-relaxed text-stone-400">
								Write shared code once and use it in every
								place. When one place needs something different,
								add a file with the same name to that
								place&apos;s folder, and it overwrites the
								shared one there.
							</p>
							<CardLink href="/docs/v2/setups/places">
								Set up places
							</CardLink>
						</div>
					</Reveal>

					<Reveal className="lg:col-span-3">
						<div className="flex flex-col gap-8 rounded-3xl border border-brand/15 bg-[linear-gradient(110deg,rgb(240_105_58/0.07),transparent_55%)] p-8 md:flex-row md:items-center md:justify-between md:p-10">
							<div className="max-w-md">
								<Index n="04" />
								<h3 className="mt-6 text-xl font-semibold tracking-[-0.02em] text-paper">
									Still Rojo
								</h3>
								<p className="mt-3 text-[15px] leading-relaxed text-stone-400">
									Rogen runs the Rojo commands you use, with
									the same flags. One tool, and nothing to
									relearn.
								</p>
								<CardLink href="/docs/v2/coming-from-rojo">
									Coming from Rojo
								</CardLink>
							</div>
							<ul className="flex flex-wrap gap-2 md:max-w-sm md:justify-end">
								{rojoVerbs.map((verb) => (
									<li
										key={verb}
										className="rounded-full border border-white/[0.08] bg-ink/70 px-4 py-2 font-mono text-[13px] text-stone-300"
									>
										<span className="text-stone-600">
											rogen{" "}
										</span>
										{verb}
									</li>
								))}
							</ul>
						</div>
					</Reveal>
				</div>
			</div>
		</section>
	);
}
