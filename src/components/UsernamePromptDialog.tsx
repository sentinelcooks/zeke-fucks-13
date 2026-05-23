import { useState } from "react";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const ACCENT = "#A855F7";
const ACCENT_DEEP = "#7B2FFF";

const USERNAME_RE = /^[A-Za-z0-9_.\- ]+$/;
const MIN_LEN = 3;
const MAX_LEN = 24;

interface Props {
  open: boolean;
  onSaved: () => void;
}

export function UsernamePromptDialog({ open, onSaved }: Props) {
  const { updateProfile, refreshProfile, user } = useAuth();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (saving) return;
    const trimmed = value.trim();
    if (trimmed.length < MIN_LEN) {
      setError(`Username must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (trimmed.length > MAX_LEN) {
      setError(`Username must be ${MAX_LEN} characters or fewer.`);
      return;
    }
    if (!USERNAME_RE.test(trimmed)) {
      setError("Use letters, numbers, spaces, _, -, or .");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await updateProfile({ display_name: trimmed });
      await supabase.auth.updateUser({ data: { display_name: trimmed } });
      if (user?.id) await refreshProfile(user.id);
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save username. Please try again.";
      if (/duplicate|unique/i.test(msg)) {
        setError("That username is already taken.");
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-[400px] border-0 p-0 [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="rounded-[24px] p-6 border"
          style={{
            background: "hsla(265, 25%, 9%, 0.96)",
            borderColor: "hsla(0, 0%, 100%, 0.06)",
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
            boxShadow: "0 20px 60px hsla(265, 50%, 4%, 0.65), inset 0 1px 0 hsla(0, 0%, 100%, 0.04)",
          }}
        >
          <DialogTitle className="text-[20px] font-bold text-white mb-1.5 leading-tight">
            Please select your username
          </DialogTitle>
          <p className="text-[12.5px] text-white/55 leading-relaxed mb-5">
            This is the name we'll show across Sentinel.
          </p>

          <input
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
            placeholder="Enter username"
            autoFocus
            maxLength={MAX_LEN}
            disabled={saving}
            className="w-full px-4 py-3 rounded-xl text-[14px] text-white placeholder:text-white/30 outline-none transition-all disabled:opacity-50"
            style={{
              background: "hsla(0,0%,100%,0.04)",
              border: "1px solid hsla(0,0%,100%,0.08)",
            }}
          />

          {error && (
            <p className="text-[12px] text-red-400 mt-2.5 leading-snug">{error}</p>
          )}

          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={handleSave}
            disabled={saving || !value.trim()}
            className="w-full py-3 rounded-full text-[13px] font-semibold mt-5 transition-all disabled:opacity-50 flex items-center justify-center"
            style={{
              background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_DEEP})`,
              boxShadow: `0 8px 24px ${ACCENT}44`,
              color: "white",
            }}
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              "Save username"
            )}
          </motion.button>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
