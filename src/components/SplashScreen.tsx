import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BrandMark } from "@/components/brand/BrandMark";

export function SplashScreen({
  onFinished,
  persistent = false,
}: {
  onFinished?: () => void;
  persistent?: boolean;
}) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 600);
    if (persistent) return () => clearTimeout(t1);
    const t2 = setTimeout(() => setPhase("exit"), 2200);
    const t3 = setTimeout(() => onFinished?.(), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onFinished, persistent]);

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background"
      initial={{ opacity: 1 }}
      animate={{ opacity: phase === "exit" ? 0 : 1 }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
      role="status"
      aria-label="Loading Sentinel"
    >
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <BrandMark size={88} />
      </motion.div>

      <motion.div
        className="mt-6 text-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
      >
        <h1 className="text-[28px] font-bold tracking-tight text-foreground">Sentinel</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Every prop, priced by the numbers.</p>
      </motion.div>

      <motion.div
        className="mt-10 h-1 w-24 overflow-hidden rounded-full bg-fill/20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <motion.div
          className="h-full w-1/3 rounded-full bg-primary"
          animate={{ x: ["-100%", "300%"] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>
    </motion.div>
  );
}
