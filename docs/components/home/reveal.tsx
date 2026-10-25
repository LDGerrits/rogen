"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export function Reveal({
	children,
	className,
	delay = 0,
}: {
	children: ReactNode;
	className?: string;
	delay?: number;
}) {
	const reduced = useReducedMotion();

	return (
		<motion.div
			className={className}
			initial={
				reduced ? false : { opacity: 0, y: 28, filter: "blur(6px)" }
			}
			whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
			viewport={{ once: true, margin: "-80px" }}
			transition={{ duration: 0.8, ease: easeOutExpo, delay }}
		>
			{children}
		</motion.div>
	);
}
