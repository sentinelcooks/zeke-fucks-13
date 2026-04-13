import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import sentinelLogo from "@/assets/sentinel-logo.jpg";

export function SplashScreen({ onFinished }: { onFinished: () => void }) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 600);
    const t2 = setTimeout(() => setPhase("exit"), 2200);
    const t3 = setTimeout(onFinished, 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onFinished]);

  return (
    <AnimatePresence>
      {phase !== "exit" ? null : null}
      <motion.div
        className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
        style={{ background: 'hsl(228, 30%, 6%)' }}
        initial={{ opacity: 1 }}
        animate={{ opacity: phase === "exit" ? 0 : 1 }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
      >
        {/* Background ambient */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-[0.06]"
            style={{ background: 'radial-gradient(circle, hsl(250 76% 62%), transparent 60%)' }} />
          <div className="absolute top-1/4 right-1/4 w-[300px] h-[300px] rounded-full opacity-[0.04]"
            style={{ background: 'radial-gradient(circle, hsl(210 100% 60%), transparent 60%)', animationDelay: '-2s' }} />
        </div>

        {/* Logo + Ring */}
        <div className="relative">
          {/* Outer spinning ring */}
          <motion.div
            className="absolute -inset-6 rounded-full"
            style={{
              border: '2px solid transparent',
              borderTopColor: 'hsl(250, 76%, 62%)',
              borderRightColor: 'hsla(210, 100%, 60%, 0.4)',
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />

          {/* Inner spinning ring (opposite) */}
          <motion.div
            className="absolute -inset-3 rounded-full"
            style={{
              border: '1.5px solid transparent',
              borderBottomColor: 'hsla(250, 76%, 62%, 0.5)',
              borderLeftColor: 'hsla(158, 64%, 52%, 0.3)',
            }}
            animate={{ rotate: -360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />

          {/* Glow behind logo */}
          <motion.div
            className="absolute -inset-4 rounded-full"
            style={{ background: 'radial-gradient(circle, hsla(250, 76%, 62%, 0.15), transparent 70%)' }}
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Logo */}
          <motion.img
            src={sentinelLogo}
            alt="Sentinel"
            className="w-20 h-20 rounded-2xl relative z-10"
            style={{ boxShadow: '0 8px 32px hsla(228, 40%, 4%, 0.6), 0 0 0 1px hsla(228, 30%, 20%, 0.3)' }}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          />
        </div>

        {/* Brand text */}
        <motion.div
          className="mt-10 text-center"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <h1 className="text-[18px] font-extrabold tracking-[0.2em] uppercase"
            style={{
              background: 'linear-gradient(135deg, hsl(250 76% 72%), hsl(210 100% 70%))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
            Sentinel
          </h1>
          <p className="text-[9px] text-white/15 font-semibold tracking-[0.3em] uppercase mt-1">AI Sports Analytics</p>
        </motion.div>

        {/* Loading dots */}
        <motion.div
          className="flex items-center gap-1.5 mt-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'hsl(250, 76%, 62%)' }}
              animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2, ease: "easeInOut" }}
            />
          ))}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
