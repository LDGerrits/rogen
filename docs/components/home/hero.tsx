"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { FaFileCode } from "react-icons/fa";
import { SiTypescript } from "react-icons/si";
import { easeOutExpo } from "./reveal";

export function Hero() {
	const reduced = useReducedMotion();
	const item = {
		hidden: reduced ? {} : { opacity: 0, y: 30, filter: "blur(8px)" },
		visible: {
			opacity: 1,
			y: 0,
			filter: "blur(0px)",
			transition: { duration: 0.8, ease: easeOutExpo },
		},
	};

	return (
		<section className="relative isolate flex min-h-[calc(100dvh-3.5rem)] flex-col px-6 pt-20 pb-14 md:pt-28 md:pb-20">
			<div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_20%_35%,rgb(255_248_240/0.06),transparent_70%)]" />
			<div className="pointer-events-none absolute -top-40 right-0 -z-10 h-[36rem] w-[36rem] rounded-full bg-brand opacity-[0.07] blur-[140px]" />

			<motion.div
				className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-between gap-16"
				initial="hidden"
				animate="visible"
				transition={{ staggerChildren: 0.12, delayChildren: 0.1 }}
			>
				<motion.p
					variants={item}
					className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-stone-500"
				>
					<span className="size-1.5 rounded-full bg-brand" />
					Rojo, with file-system routing
				</motion.p>

				<motion.h1
					variants={item}
					className="text-[clamp(3rem,7.6vw,7.5rem)] font-semibold leading-[0.92] tracking-[-0.045em] text-paper"
				>
					Professional-grade
					<br />
					<span className="text-stone-400">architecture</span> for
					Roblox
				</motion.h1>

				<div className="grid gap-10 md:grid-cols-12 md:items-end">
					<motion.div
						variants={item}
						className="order-2 flex items-center gap-5 font-mono text-xs uppercase tracking-[0.14em] text-stone-500 md:order-1 md:col-span-5"
					>
						<span className="flex items-center gap-2">
							<FaFileCode className="text-stone-400" />
							Luau
						</span>
						<span className="h-3 w-px bg-white/10" />
						<span className="flex items-center gap-2">
							<SiTypescript className="text-stone-400" />
							roblox-ts
						</span>
					</motion.div>

					<motion.div
						variants={item}
						className="order-1 flex flex-col items-start gap-8 md:order-2 md:col-span-6 md:col-start-7"
					>
						<p className="max-w-[44ch] text-lg leading-relaxed text-stone-400 md:text-xl">
							Rogen is a superset of Rojo that generates Rojo
							project files from your folders, so you can organize
							your game by feature.
						</p>
						<Link
							href="/docs/v2/installation"
							className="group inline-flex min-h-12 items-center gap-3 rounded-full bg-paper py-3.5 pr-5 pl-7 text-sm font-semibold text-ink transition-[transform,box-shadow] duration-500 ease-out-expo hover:-translate-y-0.5 hover:shadow-[0_10px_40px_-10px_rgb(240_105_58/0.6)] active:translate-y-0 active:scale-[0.98]"
						>
							Get started
							<span className="grid size-6 place-items-center rounded-full bg-ink text-paper transition-transform duration-500 ease-out-expo group-hover:translate-x-0.5">
								→
							</span>
						</Link>
					</motion.div>
				</div>
			</motion.div>
		</section>
	);
}
