import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Trophy } from "lucide-react";
import { motion } from "framer-motion";
import logo from "@/assets/sentinel-lock.jpg";
import WaveImage from "@/components/onboarding/WaveImage";

const STADIUM = {
  key: "stadium-bg",
  model: "wavespeed-ai/flux-dev/lora/krea" as const,
  prompt:
    "Cinematic silhouette of a person standing in a massive sports stadium at night, looking out at the field, dramatic purple and violet atmospheric lighting from stadium lights, fog, moody, dark, wide angle, ultra realistic",
};

export default function WelcomeConfirmationPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const id = setTimeout(() => navigate("/dashboard", { replace: true }), 3500);
    return () => clearTimeout(id);
  }, [navigate]);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0A0A0A] text-white">
      <style>{`
        @keyframes ken-burns { from { transform: scale(1) } to { transform: scale(1.06) } }
      `}</style>

      {/* Stadium background, full bleed, with Ken Burns slow zoom */}
      <div className="absolute inset-0" style={{ animation: "ken-burns 12s ease-out forwards" }}>
        <WaveImage
          prompt={STADIUM.prompt}
          cacheKey={STADIUM.key}
          model={STADIUM.model}
          alt="Stadium"
          rounded="md"
          className="w-full h-full"
          fallbackClassName="bg-gradient-to-b from-[#1a0d2e] via-[#0A0A0A] to-[#0A0A0A]"
        />
      </div>
      {/* Dark overlay for legibility */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/40 via-[#0A0A0A]/55 to-[#0A0A0A]/85 pointer-events-none" />

      {/* Decorative watermark */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-[20vw] font-black tracking-[0.15em] text-white/[0.025] select-none">SENTINEL</span>
      </div>

      {/* Progress (all dots green) */}
      <div className="relative z-10 px-5 py-6">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white/70">6 / 6</span>
          <div className="flex gap-1.5 ml-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-1.5 w-[22px] rounded-full bg-[#00FF6A]" />
            ))}
          </div>
        </div>
      </div>

      {/* Centered content */}
      <div className="relative z-10 flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: "calc(100vh - 120px)" }}>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="flex flex-col items-center">
          <div className="relative">
            <div className="absolute inset-0 rounded-2xl bg-[#00FF6A]/30 blur-2xl" />
            <img src={logo} alt="Sentinel" className="relative w-16 h-16 rounded-2xl" />
          </div>
          <p className="mt-3 text-[11px] font-bold tracking-[0.35em] text-white/70">SENTINEL</p>

          <h1 className="mt-6 text-[40px] leading-[1.05] font-extrabold">
            You're Ready.<br />
            <span className="text-[#00FF6A]">Let's Win.</span>
          </h1>
          <p className="mt-3 text-base text-white/70">Smarter bets. Bigger results.</p>
        </motion.div>
      </div>

      {/* Welcome toast */}
      <motion.button
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        onClick={() => navigate("/dashboard", { replace: true })}
        className="fixed left-1/2 -translate-x-1/2 bottom-6 z-20 w-[calc(100%-2.5rem)] max-w-md rounded-2xl border border-[#2A2A2A] bg-[#141414]/95 backdrop-blur px-4 py-3 flex items-center gap-3 text-left shadow-2xl shadow-black/50"
      >
        <div className="w-10 h-10 rounded-xl bg-[#00FF6A]/15 flex items-center justify-center flex-shrink-0">
          <Trophy className="w-5 h-5 text-[#00FF6A]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-white">Welcome to Sentinel</div>
          <div className="text-xs text-white/60">Your edge starts now.</div>
        </div>
      </motion.button>
    </div>
  );
}
