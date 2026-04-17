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
    <div className="relative min-h-screen w-full overflow-hidden bg-[#050508] text-white">
      <style>{`
        @keyframes ken-burns { from { transform: scale(1) } to { transform: scale(1.06) } }
        @keyframes float-particle {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.4 }
          50% { transform: translate(8px, -16px) scale(1.15); opacity: 0.9 }
        }
      `}</style>

      {/* Layered background scene */}
      <div className="fixed inset-0 z-0 overflow-hidden">
        {/* Deep base */}
        <div className="absolute inset-0 bg-[#050508]" />

        {/* Stadium photo at 30% as additional layer */}
        <div className="absolute inset-0 opacity-30" style={{ animation: "ken-burns 12s ease-out forwards" }}>
          <WaveImage
            prompt={STADIUM.prompt}
            cacheKey={STADIUM.key}
            model={STADIUM.model}
            alt="Stadium"
            rounded="md"
            className="w-full h-full"
            fallbackClassName="bg-transparent"
          />
        </div>

        {/* Subtle green grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(#00FF6A 1px, transparent 1px), linear-gradient(90deg, #00FF6A 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />

        {/* Central purple radial glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] h-[720px] rounded-full bg-[#7B2FFF]/25 blur-[140px]" />
        {/* Green ambient glow behind logo */}
        <div className="absolute top-[42%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] rounded-full bg-[#00FF6A]/15 blur-[120px]" />
        {/* Bottom dark fade */}
        <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-[#050508] via-[#050508]/85 to-transparent" />

        {/* Floating green particles */}
        {[
          { x: "12%", y: "22%", d: 0, dur: 6 },
          { x: "82%", y: "30%", d: 1.2, dur: 7 },
          { x: "20%", y: "70%", d: 0.5, dur: 5.5 },
          { x: "78%", y: "65%", d: 2, dur: 6.8 },
          { x: "50%", y: "18%", d: 1.6, dur: 7.4 },
          { x: "55%", y: "80%", d: 0.8, dur: 6.2 },
        ].map((p, i) => (
          <div
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full bg-[#00FF6A]"
            style={{
              left: p.x,
              top: p.y,
              boxShadow: "0 0 10px rgba(0,255,106,0.9), 0 0 20px rgba(0,255,106,0.5)",
              animation: `float-particle ${p.dur}s ease-in-out ${p.d}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Decorative SENTINEL watermark */}
      <div className="absolute inset-0 z-[1] flex items-center justify-center pointer-events-none">
        <span
          className="text-[20vw] font-black tracking-[0.15em] select-none"
          style={{ color: "rgba(255,255,255,0.04)" }}
        >
          SENTINEL
        </span>
      </div>

      {/* Progress (all dots green, glowing active style on the last one) */}
      <div className="relative z-10 px-5 py-6">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white/70">6 / 6</span>
          <div className="flex gap-1.5 ml-1 items-center">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-1.5 rounded-full"
                style={{
                  width: i === 5 ? 28 : 14,
                  backgroundColor: i === 5 ? "#00FF6A" : "rgba(0,255,106,0.7)",
                  boxShadow:
                    i === 5
                      ? "0 0 12px rgba(0,255,106,0.8), 0 0 24px rgba(0,255,106,0.45)"
                      : "0 0 6px rgba(0,255,106,0.35)",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Centered content */}
      <div className="relative z-10 flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: "calc(100vh - 200px)" }}>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="flex flex-col items-center">
          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-[#00FF6A]/40 blur-3xl" />
            <div className="absolute -inset-1 rounded-2xl bg-[#00FF6A]/30 blur-xl" />
            <img
              src={logo}
              alt="Sentinel"
              className="relative w-16 h-16 rounded-2xl"
              style={{ boxShadow: "0 0 36px 6px rgba(0,255,106,0.5), 0 0 72px 12px rgba(0,255,106,0.22)" }}
            />
          </div>
          <p className="mt-3 text-[11px] font-extrabold tracking-[0.4em] text-white/80">SENTINEL</p>

          <h1 className="mt-6 text-[40px] leading-[1.05] font-extrabold">
            You're Ready.<br />
            <span className="text-[#00FF6A]">Let's Win.</span>
          </h1>
          <p className="mt-3 text-base text-white/70">Smarter bets. Bigger results.</p>
        </motion.div>
      </div>

      {/* Welcome glassmorphism toast */}
      <motion.button
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        onClick={() => navigate("/dashboard", { replace: true })}
        className="fixed bottom-8 left-5 right-5 max-w-md mx-auto z-50 rounded-2xl px-4 py-3 flex items-center gap-3 text-left backdrop-blur-xl"
        style={{
          background: "rgba(20,20,20,0.95)",
          border: "1px solid rgba(0,255,106,0.35)",
          boxShadow:
            "0 0 24px rgba(0,255,106,0.25), 0 12px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        <div className="w-12 h-12 rounded-xl bg-[#00FF6A]/15 flex items-center justify-center flex-shrink-0 border border-[#00FF6A]/25">
          <Trophy className="w-6 h-6 text-[#00FF6A]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-white">🏆 Welcome to Sentinel</div>
          <div className="text-xs text-white/60">Your edge starts now.</div>
        </div>
      </motion.button>
    </div>
  );
}
