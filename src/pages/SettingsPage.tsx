import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Globe, Bell, BellOff, LogOut, User, Check, ChevronRight, ChevronDown, Hash, MessageSquare, Send, Loader2, CheckCircle, CreditCard, Calculator, DollarSign, RefreshCw, Trash2 } from "lucide-react";
import { getActiveUnitSize, readUnitSettings } from "@/lib/profitFormat";

import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { restorePurchases, getSubscriptionManagementURL } from "@/lib/revenuecat";
import { usePremium } from "@/contexts/PremiumContext";
import { openExternal } from "@/lib/openExternal";
import { resolveDisplayName } from "@/lib/displayName";
import {
  isPushSupported,
  requestAndRegisterPush,
  checkPushPermission,
  unregisterPushToken,
} from "@/services/pushNotificationService";

const MANAGE_SUBSCRIPTION_URL = "https://apps.apple.com/account/subscriptions";

const TIMEZONES = [
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage", label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii (HT)" },
  { value: "America/Phoenix", label: "Arizona (MST)" },
  { value: "America/Toronto", label: "Toronto (ET)" },
  { value: "Europe/London", label: "London (GMT)" },
  { value: "Europe/Paris", label: "Paris (CET)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
];

const ODDS_FORMATS = [
  { value: "american", label: "American", example: "-110 / +150" },
  { value: "decimal", label: "Decimal", example: "1.91 / 2.50" },
];

const USERNAME_RE = /^[A-Za-z0-9_.\- ]+$/;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 24;

const formatAccessDate = (value: string | null, includeTime: boolean) => {
  if (!value) return "Expiration date unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Expiration date unavailable";
  return new Intl.DateTimeFormat("en-US", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }
  ).format(date);
};

const ContactUsSection = () => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.subject.trim() || !form.message.trim()) {
      toast.error("Please fill in all fields");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      toast.error("Please enter a valid email address");
      return;
    }
    setLoading(true);
    const { error } = await supabase.from("contact_submissions").insert({
      name: form.name.trim().slice(0, 100),
      email: form.email.trim().slice(0, 255),
      subject: form.subject.trim().slice(0, 200),
      message: form.message.trim().slice(0, 2000),
    });
    setLoading(false);
    if (error) {
      toast.error("Something went wrong. Please try again.");
      return;
    }
    setSent(true);
    toast.success("Message sent successfully!");
  };

  const handleClose = () => {
    setOpen(false);
    setTimeout(() => { setSent(false); setForm({ name: "", email: "", subject: "", message: "" }); }, 300);
  };

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="relative z-10">
        <button
          onClick={() => setOpen(true)}
          className="w-full vision-card px-5 py-4 flex items-center gap-3 hover:bg-secondary/20 transition-colors"
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))' }}>
            <MessageSquare className="w-4 h-4 text-white" />
          </div>
          <div className="text-left flex-1">
            <p className="text-[13px] font-bold text-foreground">Contact Us</p>
            <p className="text-[9px] text-muted-foreground/55">Send us a message or question</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground/55" />
        </button>
      </motion.div>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="bg-card border-border/50 rounded-2xl max-w-md mx-auto p-0 overflow-hidden">
          <div className="p-6">
            <DialogHeader className="mb-5">
              <DialogTitle className="text-lg font-bold text-foreground">Get in Touch</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">Send us a message and we'll get back to you as soon as possible.</DialogDescription>
            </DialogHeader>
            {sent ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                <CheckCircle className="w-12 h-12 text-green-400" />
                <p className="text-foreground font-semibold text-base">Message Sent!</p>
                <p className="text-muted-foreground text-xs">We'll review your message and respond shortly.</p>
                <Button variant="ghost" onClick={handleClose} className="mt-2 text-xs text-accent">Close</Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="contact-name" className="text-xs text-muted-foreground">Name</Label>
                  <Input id="contact-name" name="name" placeholder="Your name" value={form.name} onChange={handleChange} maxLength={100} className="bg-secondary/50 border-border/40 rounded-xl h-10 text-sm placeholder:text-muted-foreground/50" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact-email" className="text-xs text-muted-foreground">Email</Label>
                  <Input id="contact-email" name="email" type="email" placeholder="you@email.com" value={form.email} onChange={handleChange} maxLength={255} className="bg-secondary/50 border-border/40 rounded-xl h-10 text-sm placeholder:text-muted-foreground/50" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact-subject" className="text-xs text-muted-foreground">Subject</Label>
                  <Input id="contact-subject" name="subject" placeholder="What's this about?" value={form.subject} onChange={handleChange} maxLength={200} className="bg-secondary/50 border-border/40 rounded-xl h-10 text-sm placeholder:text-muted-foreground/50" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact-message" className="text-xs text-muted-foreground">Message</Label>
                  <Textarea id="contact-message" name="message" placeholder="Tell us more..." value={form.message} onChange={handleChange} maxLength={2000} rows={4} className="bg-secondary/50 border-border/40 rounded-xl text-sm placeholder:text-muted-foreground/50 resize-none" />
                </div>
                <Button type="submit" disabled={loading} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground font-semibold rounded-xl h-11 gap-2">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {loading ? "Sending…" : "Send Message"}
                </Button>
              </form>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

const RISK_PRESETS = [
  { value: "conservative", label: "Conservative", pct: 1 },
  { value: "standard", label: "Standard", pct: 2 },
  { value: "aggressive", label: "Aggressive", pct: 3 },
  { value: "custom", label: "Custom", pct: null },
] as const;

type RiskPreset = "conservative" | "standard" | "aggressive" | "custom";

type UnitSetupModeLocal = "calculated" | "manual";

const UnitCalculatorSection = () => {
  const [setupMode, setSetupMode] = useState<UnitSetupModeLocal>(
    () => (localStorage.getItem("sentinel_unit_setup_mode") as UnitSetupModeLocal) ?? "calculated"
  );
  const [bankroll, setBankroll] = useState<string>(
    () => localStorage.getItem("sentinel_unit_bankroll") ?? ""
  );
  const [riskPreset, setRiskPreset] = useState<RiskPreset>(
    () => (localStorage.getItem("sentinel_unit_risk") as RiskPreset) ?? "standard"
  );
  const [customPct, setCustomPct] = useState<string>(
    () => localStorage.getItem("sentinel_unit_custom_pct") ?? "2"
  );
  const [manualUnit, setManualUnit] = useState<string>(
    () => localStorage.getItem("sentinel_unit_manual") ?? ""
  );
  const [isUnitCalculatorOpen, setIsUnitCalculatorOpen] = useState(false);

  const dispatchChanged = () =>
    window.dispatchEvent(new Event("sentinel:settings-changed"));

  useEffect(() => {
    localStorage.setItem("sentinel_unit_setup_mode", setupMode);
    dispatchChanged();
  }, [setupMode]);

  useEffect(() => {
    localStorage.setItem("sentinel_unit_bankroll", bankroll);
    dispatchChanged();
  }, [bankroll]);

  useEffect(() => {
    localStorage.setItem("sentinel_unit_risk", riskPreset);
    dispatchChanged();
  }, [riskPreset]);

  useEffect(() => {
    localStorage.setItem("sentinel_unit_custom_pct", customPct);
    dispatchChanged();
  }, [customPct]);

  useEffect(() => {
    localStorage.setItem("sentinel_unit_manual", manualUnit);
    dispatchChanged();
  }, [manualUnit]);

  const PRESET_PCTS = { conservative: 1, standard: 2, aggressive: 3 } as const;
  const pct = riskPreset === "custom" ? parseFloat(customPct) : PRESET_PCTS[riskPreset];
  const bankrollNum = parseFloat(bankroll);
  const manualUnitNum = parseFloat(manualUnit);

  // Derive active unit size via shared helper
  const unitSize = getActiveUnitSize(readUnitSettings());

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  const showCustomWarning = setupMode === "calculated" && riskPreset === "custom" && Number.isFinite(pct) && pct > 3 && pct <= 100;
  const customInvalid = setupMode === "calculated" && riskPreset === "custom" && (!Number.isFinite(pct) || pct <= 0 || pct > 100);

  let resultNode: React.ReactNode;

  if (setupMode === "manual") {
    if (manualUnit === "") {
      resultNode = (
        <p className="text-[11px] text-muted-foreground/55 text-center py-2">
          Enter your 1U amount.
        </p>
      );
    } else if (!Number.isFinite(manualUnitNum) || manualUnitNum <= 0) {
      resultNode = (
        <p className="text-[11px] text-destructive text-center py-2">
          Enter a valid unit amount.
        </p>
      );
    } else {
      resultNode = (
        <div className="space-y-3">
          <div className="bg-secondary/40 rounded-xl p-4 space-y-3">
            <div className="text-center">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-1">
                Current 1U
              </p>
              <p className="text-2xl font-bold" style={{ color: "hsl(142 100% 50%)" }}>
                {fmt(manualUnitNum)}
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {([0.5, 1, 2, 3] as const).map((mult) => (
                <div
                  key={mult}
                  className="flex flex-col items-center gap-0.5 bg-secondary/50 rounded-lg py-2"
                >
                  <span className="text-[9px] font-bold text-muted-foreground/55">{mult}U</span>
                  <span className="text-[11px] font-bold text-foreground">{fmt(manualUnitNum * mult)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
  } else {
    // calculated mode
    if (bankroll === "") {
      resultNode = (
        <p className="text-[11px] text-muted-foreground/55 text-center py-2">
          Enter your bankroll to see your unit size.
        </p>
      );
    } else if (!Number.isFinite(bankrollNum) || bankrollNum <= 0 || customInvalid) {
      resultNode = (
        <p className="text-[11px] text-destructive text-center py-2">
          Enter a valid bankroll amount.
        </p>
      );
    } else {
      const unit = unitSize ?? 0;
      resultNode = (
        <div className="space-y-3">
          {showCustomWarning && (
            <p className="text-[10px] text-amber-400/80 text-center">
              Most users keep units between 1–3% for safer bankroll management.
            </p>
          )}
          <div className="bg-secondary/40 rounded-xl p-4 space-y-3">
            <div className="text-center">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-1">
                Recommended Unit Size
              </p>
              <p className="text-2xl font-bold" style={{ color: "hsl(142 100% 50%)" }}>
                {fmt(unit)}
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {([0.5, 1, 2, 3] as const).map((mult) => (
                <div
                  key={mult}
                  className="flex flex-col items-center gap-0.5 bg-secondary/50 rounded-lg py-2"
                >
                  <span className="text-[9px] font-bold text-muted-foreground/55">{mult}U</span>
                  <span className="text-[11px] font-bold text-foreground">{fmt(unit * mult)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.275 }}
      className="vision-card overflow-hidden relative z-10"
    >
      <button
        type="button"
        onClick={() => setIsUnitCalculatorOpen((prev) => !prev)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))" }}
        >
          <Calculator className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-[13px] font-bold text-foreground">Unit Size Calculator</p>
          <p className="text-[9px] text-muted-foreground/55">Calculate your unit size based on bankroll</p>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground/55 transition-transform ${
            isUnitCalculatorOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isUnitCalculatorOpen && (
      <div className="px-5 pb-5 pt-4 space-y-4 border-t border-border/20">
        {/* Setup mode segmented control */}
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground/65">Setup Mode</Label>
          <div
            className="flex rounded-xl p-1 gap-1"
            style={{
              background: "hsla(228, 20%, 8%, 0.6)",
              border: "1px solid hsla(228, 30%, 16%, 0.25)",
            }}
          >
            {([
              { value: "calculated", label: "Calculate from bankroll" },
              { value: "manual", label: "Manual unit size" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSetupMode(opt.value)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-lg text-center transition-all duration-300 ${
                  setupMode === opt.value
                    ? "text-[hsl(228_30%_8%)]"
                    : "text-muted-foreground/65 hover:text-foreground/50"
                }`}
                style={
                  setupMode === opt.value
                    ? {
                        background: "linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))",
                        boxShadow: "0 4px 12px -2px hsla(142,100%,50%,0.3)",
                      }
                    : {}
                }
              >
                <span className="text-[11px] font-bold tracking-wider">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {setupMode === "calculated" && (
          <>
            {/* Bankroll input */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground/65">Bankroll</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/55 pointer-events-none">
                  $
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={bankroll}
                  onChange={(e) => setBankroll(e.target.value)}
                  className="bg-secondary/50 border-border/40 rounded-xl h-10 text-sm pl-7 placeholder:text-muted-foreground/50"
                />
              </div>
            </div>

            {/* Risk preset segmented control */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground/65">Risk Level</Label>
              <div
                className="flex rounded-xl p-1 gap-1 flex-wrap"
                style={{
                  background: "hsla(228, 20%, 8%, 0.6)",
                  border: "1px solid hsla(228, 30%, 16%, 0.25)",
                }}
              >
                {RISK_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setRiskPreset(preset.value)}
                    className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-lg text-center transition-all duration-300 min-w-[60px] ${
                      riskPreset === preset.value
                        ? "text-[hsl(228_30%_8%)]"
                        : "text-muted-foreground/65 hover:text-foreground/50"
                    }`}
                    style={
                      riskPreset === preset.value
                        ? {
                            background: "linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))",
                            boxShadow: "0 4px 12px -2px hsla(142,100%,50%,0.3)",
                          }
                        : {}
                    }
                  >
                    <span className="text-[11px] font-bold tracking-wider">{preset.label}</span>
                    {preset.pct !== null && (
                      <span
                        className={`text-[9px] font-semibold ${
                          riskPreset === preset.value
                            ? "text-[hsl(228_30%_8%)]/75"
                            : "text-muted-foreground/50"
                        }`}
                      >
                        {preset.pct}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom % input */}
            {riskPreset === "custom" && (
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground/65">Custom % per unit</Label>
                <div className="relative">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0.1"
                    max="100"
                    step="0.1"
                    placeholder="2.0"
                    value={customPct}
                    onChange={(e) => setCustomPct(e.target.value)}
                    className="bg-secondary/50 border-border/40 rounded-xl h-10 text-sm placeholder:text-muted-foreground/50 pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/55 pointer-events-none">
                    %
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {setupMode === "manual" && (
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground/65">1U Amount ($)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/55 pointer-events-none">
                $
              </span>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="0.00"
                value={manualUnit}
                onChange={(e) => setManualUnit(e.target.value)}
                className="bg-secondary/50 border-border/40 rounded-xl h-10 text-sm pl-7 placeholder:text-muted-foreground/50"
              />
            </div>
          </div>
        )}

        {/* Results panel */}
        {resultNode}

        {/* Education footer */}
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground/65">
            A unit is a fixed bet size based on your bankroll. Using units helps you manage risk and avoid betting random amounts.
          </p>
          <p className="text-[10px] text-muted-foreground/65">
            Most bettors use 1–3% of their bankroll as 1 unit. Never bet more than you can afford to lose.
          </p>
        </div>
      </div>
      )}
    </motion.div>
  );
};

const PROFIT_DISPLAY_MODES = [
  { value: "dollars", label: "Dollars ($)" },
  { value: "units", label: "Units (U)" },
] as const;

const ProfitDisplayModeSection = () => {
  const [mode, setMode] = useState<"dollars" | "units">(
    () => (localStorage.getItem("sentinel_profit_display_mode") as "dollars" | "units") ?? "dollars"
  );

  const handleModeChange = (newMode: "dollars" | "units") => {
    setMode(newMode);
    localStorage.setItem("sentinel_profit_display_mode", newMode);
    window.dispatchEvent(new Event("sentinel:settings-changed"));
  };

  const unitSize = getActiveUnitSize(readUnitSettings());
  const showHint = mode === "units" && !unitSize;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.285 }}
      className="vision-card overflow-hidden relative z-10"
    >
      <div className="px-5 py-3 border-b border-border/20">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">
          Profit Display Mode
        </span>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-center gap-3 mb-1">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))" }}
          >
            <DollarSign className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-foreground">Display Format</p>
            <p className="text-[9px] text-muted-foreground/55">How profit/loss is shown across the app</p>
          </div>
        </div>
        <div
          className="flex rounded-xl p-1 gap-1"
          style={{
            background: "hsla(228, 20%, 8%, 0.6)",
            border: "1px solid hsla(228, 30%, 16%, 0.25)",
          }}
        >
          {PROFIT_DISPLAY_MODES.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleModeChange(opt.value)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-lg text-center transition-all duration-300 ${
                mode === opt.value
                  ? "text-[hsl(228_30%_8%)]"
                  : "text-muted-foreground/65 hover:text-foreground/50"
              }`}
              style={
                mode === opt.value
                  ? {
                      background: "linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))",
                      boxShadow: "0 4px 12px -2px hsla(142,100%,50%,0.3)",
                    }
                  : {}
              }
            >
              <span className="text-[11px] font-bold tracking-wider">{opt.label}</span>
            </button>
          ))}
        </div>
        {showHint && (
          <p className="text-[10px] text-muted-foreground/55 text-center">
            Set your unit size above to view profit in units.
          </p>
        )}
      </div>
    </motion.div>
  );
};

const SettingsPage = () => {
  const { profile, user, updateProfile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [selectedTz, setSelectedTz] = useState(profile?.timezone || "America/New_York");
  const [notifEnabled, setNotifEnabled] = useState(profile?.notification_enabled || false);
  const [oddsFormat, setOddsFormat] = useState<"american" | "decimal">(profile?.odds_format || "american");
  const [saving, setSaving] = useState(false);
  const [showTzPicker, setShowTzPicker] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [isManagingSubscription, setIsManagingSubscription] = useState(false);

  const handleManageSubscription = async () => {
    if (isManagingSubscription) return;
    setIsManagingSubscription(true);
    try {
      const url = await getSubscriptionManagementURL();
      await openExternal(url);
    } catch (error) {
      console.error("Failed to open subscription management:", error);
      toast.error(
        "Unable to open subscription management. Please open the App Store > Account > Subscriptions."
      );
    } finally {
      setIsManagingSubscription(false);
    }
  };

  useEffect(() => {
    if (profile) {
      setSelectedTz(profile.timezone);
      setNotifEnabled(profile.notification_enabled);
      setOddsFormat(profile.odds_format || "american");
    }
  }, [profile]);

  // Auto-detect device timezone on first load
  useEffect(() => {
    if (!profile) return;
    const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const matchedTz = TIMEZONES.find((t) => t.value === deviceTz);
    if (matchedTz && profile.timezone === "America/New_York" && deviceTz !== "America/New_York") {
      handleTzChange(deviceTz);
    }
  }, [profile?.id]);

  const handleTzChange = async (tz: string) => {
    setSelectedTz(tz);
    setShowTzPicker(false);
    setSaving(true);
    await updateProfile({ timezone: tz });
    setSaving(false);
  };

  const handleNotifToggle = async () => {
    const turningOn = !notifEnabled;

    if (turningOn) {
      if (isPushSupported()) {
        // Native iOS — triggers system "Allow Notifications?" dialog
        const status = await requestAndRegisterPush();
        if (status === "denied") {
          toast.error("Notifications denied. Enable in iPhone Settings > Sentinel.");
          return;
        }
        if (status === "error") {
          toast.error("Could not register for notifications. Try again.");
          return;
        }
        // status === "granted": APNs token saved by registration listener
      } else if ("Notification" in window) {
        // Web fallback
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return;
      }
    } else {
      if (isPushSupported()) await unregisterPushToken();
    }

    setNotifEnabled(turningOn);
    setSaving(true);
    await updateProfile({ notification_enabled: turningOn });
    setSaving(false);
  };

  // Sync UI if iOS permissions were revoked externally (Settings > Sentinel)
  useEffect(() => {
    if (!profile?.id || !isPushSupported()) return;
    checkPushPermission().then((status) => {
      if (status === "denied" && profile.notification_enabled) {
        setNotifEnabled(false);
        updateProfile({ notification_enabled: false });
      }
    });
  }, [profile?.id]);

  const handleOddsFormatChange = async (format: "american" | "decimal") => {
    setOddsFormat(format);
    setSaving(true);
    await updateProfile({ odds_format: format });
    setSaving(false);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  const {
    status: premiumStatus,
    isPremium,
    isLoading: premiumLoading,
    hasLifetimeAccess,
    accessSource,
    accessType,
    accessExpiresAt,
    refresh: refreshPremium,
  } = usePremium();
  const [restoring, setRestoring] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleRestore = async () => {
    if (!Capacitor.isNativePlatform()) {
      toast.info("Restore Purchases is available in the iOS app.");
      return;
    }
    setRestoring(true);
    try {
      const restored = await restorePurchases();
      await refreshPremium();
      toast[restored ? "success" : "info"](
        restored
          ? "Purchase restored. Sentinel Premium is active."
          : "No active Sentinel Premium subscription was found for this Apple ID."
      );
    } catch (err) {
      console.error("Restore failed:", err);
      toast.error("Restore failed. Try again.");
    } finally {
      setRestoring(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke("delete-account");
      if (error) {
        toast.error(error.message || "Could not delete account. Try again.");
        setDeleting(false);
        return;
      }
      toast.success("Account deleted.");
      setDeleteOpen(false);
      await signOut();
      navigate("/auth", { replace: true });
    } catch (err) {
      console.error("Delete account failed:", err);
      toast.error("Could not delete account. Try again.");
      setDeleting(false);
    }
  };

  const currentTzLabel = TIMEZONES.find((t) => t.value === selectedTz)?.label || selectedTz;
  const isTemporaryAccess = isPremium && accessSource === "premium_override" && !hasLifetimeAccess;
  const accessTypeLabel = hasLifetimeAccess
    ? "Lifetime Access"
    : isTemporaryAccess
      ? "Temporary Access"
      : isPremium && accessSource === "revenuecat"
        ? "RevenueCat subscription"
        : isPremium && accessType
          ? accessType
          : "No active subscription";
  const subscriptionTitle = premiumLoading
    ? "Checking subscription status..."
    : premiumStatus === "error"
      ? "Subscription status unavailable"
      : hasLifetimeAccess
        ? "Sentinel Premium: Lifetime Access"
        : isTemporaryAccess
          ? "Sentinel Premium: Temporary Access"
          : isPremium
            ? "Sentinel Premium: Active"
            : "Subscription required";
  const subscriptionTiming = premiumLoading
    ? "Loading access details..."
    : premiumStatus === "error"
      ? "Unable to load subscription details right now."
      : hasLifetimeAccess
        ? "No expiration"
        : isTemporaryAccess
          ? `Expires: ${formatAccessDate(accessExpiresAt, true)}`
          : isPremium
            ? `Renews/Expires: ${formatAccessDate(accessExpiresAt, false)}`
            : "No active Sentinel Premium subscription";

  const openAccount = () => {
    setUsername(resolveDisplayName(profile, user, ""));
    setUsernameError(null);
    setAccountOpen(true);
  };

  const handleUsernameSave = async () => {
    if (usernameSaving || !user) return;
    const trimmed = username.trim();
    if (trimmed.length < USERNAME_MIN_LENGTH) {
      setUsernameError(`Username must be at least ${USERNAME_MIN_LENGTH} characters.`);
      return;
    }
    if (trimmed.length > USERNAME_MAX_LENGTH) {
      setUsernameError(`Username must be ${USERNAME_MAX_LENGTH} characters or fewer.`);
      return;
    }
    if (!USERNAME_RE.test(trimmed)) {
      setUsernameError("Use letters, numbers, spaces, _, -, or .");
      return;
    }

    setUsernameSaving(true);
    setUsernameError(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: trimmed })
        .eq("id", user.id);
      if (error) throw error;

      const { error: metadataError } = await supabase.auth.updateUser({ data: { display_name: trimmed } });
      if (metadataError) console.error("Username metadata sync failed:", metadataError);

      await refreshProfile(user.id);
      setUsername(trimmed);
      if (metadataError) {
        toast.warning("Username updated, but account metadata could not be refreshed.");
      } else {
        toast.success("Username updated.");
      }
    } catch (error) {
      console.error("Username save failed:", error);
      const message = error instanceof Error ? error.message : "Could not update username. Please try again.";
      setUsernameError(/duplicate|unique/i.test(message) ? "That username is already taken." : message);
    } finally {
      setUsernameSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-2 pb-4 space-y-4 relative">
      <div className="vision-orb w-48 h-48 -top-10 -right-10" style={{ background: 'hsl(142 100% 50%)' }} />

      

      {/* Account */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="vision-card overflow-hidden relative z-10">
        <div className="px-5 py-3 border-b border-border/20">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">Account</span>
        </div>
        <button
          type="button"
          onClick={openAccount}
          className="w-full px-5 py-4 flex items-center gap-3 text-left hover:bg-secondary/20 active:bg-secondary/30 transition-colors"
        >
          <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))' }}>
            <User className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-foreground truncate">
              {resolveDisplayName(profile, user, "User")}
            </p>
            <p className="text-[10px] text-muted-foreground/65 truncate">{user?.email}</p>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground/55">
            <span className="hidden min-[360px]:inline text-[9px] font-bold uppercase tracking-wider">Manage</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </button>
      </motion.div>

      <Dialog open={accountOpen} onOpenChange={(open) => !usernameSaving && setAccountOpen(open)}>
        <DialogContent className="bg-card border-border/50 rounded-2xl max-w-md mx-auto p-0 overflow-hidden">
          <div className="p-6 space-y-5">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-foreground">Account Details</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Manage your Sentinel profile and subscription access.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl bg-secondary/35 border border-border/25 p-4 space-y-2">
              <p className="text-[13px] font-bold text-foreground">{subscriptionTitle}</p>
              <p className="text-[11px] text-muted-foreground">{subscriptionTiming}</p>
              {!premiumLoading && premiumStatus !== "error" && (
                <div className="flex items-center justify-between gap-3 pt-2 mt-2 border-t border-border/20">
                  <span className="text-[10px] text-muted-foreground/65">Access type</span>
                  <span className="text-[11px] font-semibold text-foreground text-right">{accessTypeLabel}</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-muted-foreground/65 mb-1">Email</p>
                <p className="text-[13px] font-medium text-foreground truncate">{user?.email || "No email available"}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="account-username" className="text-[10px] text-muted-foreground/65">Username</Label>
                <Input
                  id="account-username"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setUsernameError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleUsernameSave();
                    }
                  }}
                  maxLength={USERNAME_MAX_LENGTH}
                  disabled={usernameSaving}
                  placeholder="Enter username"
                  className="bg-secondary/50 border-border/40 rounded-xl h-10 text-sm placeholder:text-muted-foreground/50"
                />
                {usernameError && <p className="text-[11px] text-destructive">{usernameError}</p>}
                <p className="text-[10px] text-muted-foreground/55">3-24 characters. Letters, numbers, spaces, `_`, `-`, and `.` allowed.</p>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={usernameSaving}
                  onClick={() => {
                    setUsername(resolveDisplayName(profile, user, ""));
                    setUsernameError(null);
                  }}
                  className="flex-1 rounded-xl h-10 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={usernameSaving}
                  onClick={() => void handleUsernameSave()}
                  className="flex-1 bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl h-10 text-xs gap-2"
                >
                  {usernameSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {usernameSaving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>

            {(accessSource === "revenuecat" || (!isPremium && Capacitor.isNativePlatform())) && (
              <div className="pt-2 border-t border-border/20 space-y-2">
                {accessSource === "revenuecat" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleManageSubscription}
                    disabled={isManagingSubscription}
                    className="w-full justify-start rounded-xl h-11 text-xs gap-2"
                  >
                    <CreditCard className="w-4 h-4 text-accent" />
                    {isManagingSubscription ? "Opening..." : "Manage Subscription"}
                  </Button>
                )}
                {Capacitor.isNativePlatform() && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleRestore()}
                    disabled={restoring}
                    className="w-full justify-start rounded-xl h-11 text-xs gap-2"
                  >
                    {restoring ? <Loader2 className="w-4 h-4 animate-spin text-accent" /> : <RefreshCw className="w-4 h-4 text-accent" />}
                    {restoring ? "Restoring Purchases..." : "Restore Purchases"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Odds Format */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="vision-card overflow-hidden relative z-10">
        <div className="px-5 py-3 border-b border-border/20">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">Odds Format</span>
        </div>
        <div className="px-5 py-4 space-y-2">
          <div className="flex items-center gap-3 mb-3">
            <Hash className="w-5 h-5 text-accent/60" />
            <div>
              <p className="text-[13px] font-bold text-foreground">Display Format</p>
              <p className="text-[9px] text-muted-foreground/55">Applies to all odds across the app</p>
            </div>
          </div>
          <div className="flex rounded-xl p-1 gap-1" style={{
            background: 'hsla(228, 20%, 8%, 0.6)',
            border: '1px solid hsla(228, 30%, 16%, 0.25)',
          }}>
            {ODDS_FORMATS.map((fmt) => (
              <button
                key={fmt.value}
                onClick={() => handleOddsFormatChange(fmt.value as "american" | "decimal")}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-lg text-center transition-all duration-300 ${
                  oddsFormat === fmt.value
                    ? "text-[hsl(228_30%_8%)]"
                    : "text-muted-foreground/65 hover:text-foreground/50"
                }`}
                style={oddsFormat === fmt.value ? {
                  background: 'linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))',
                  boxShadow: '0 4px 12px -2px hsla(142,100%,50%,0.3)',
                } : {}}
              >
                <span className="text-[11px] font-bold tracking-wider">{fmt.label}</span>
                <span className={`text-[9px] font-semibold ${oddsFormat === fmt.value ? "text-[hsl(228_30%_8%)]/75" : "text-muted-foreground/50"}`}>{fmt.example}</span>
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Timezone */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="vision-card overflow-hidden relative z-10">
        <div className="px-5 py-3 border-b border-border/20">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">Timezone</span>
        </div>
        <button
          onClick={() => setShowTzPicker(!showTzPicker)}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-secondary/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-accent/60" />
            <div className="text-left">
              <p className="text-[13px] font-bold text-foreground">{currentTzLabel}</p>
              <p className="text-[9px] text-muted-foreground/55">Game times displayed in your timezone</p>
            </div>
          </div>
          <ChevronRight className={`w-4 h-4 text-muted-foreground/55 transition-transform ${showTzPicker ? "rotate-90" : ""}`} />
        </button>

        {showTzPicker && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className="border-t border-border/20 max-h-[300px] overflow-y-auto"
          >
            {TIMEZONES.map((tz) => (
              <button
                key={tz.value}
                onClick={() => handleTzChange(tz.value)}
                className={`w-full px-5 py-3 flex items-center justify-between text-left transition-colors ${
                  selectedTz === tz.value ? "bg-accent/8" : "hover:bg-secondary/20"
                }`}
              >
                <span className={`text-[12px] font-medium ${selectedTz === tz.value ? "text-accent" : "text-foreground/70"}`}>
                  {tz.label}
                </span>
                {selectedTz === tz.value && <Check className="w-4 h-4 text-accent" />}
              </button>
            ))}
          </motion.div>
        )}
      </motion.div>

      {/* Notifications */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="vision-card overflow-hidden relative z-10">
        <div className="px-5 py-3 border-b border-border/20">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">Notifications</span>
        </div>
        <button
          onClick={handleNotifToggle}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-secondary/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            {notifEnabled ? <Bell className="w-5 h-5 text-nba-green" /> : <BellOff className="w-5 h-5 text-muted-foreground/55" />}
            <div className="text-left">
              <p className="text-[13px] font-bold text-foreground">Game Notifications</p>
              <p className="text-[9px] text-muted-foreground/55">Get alerts before games start</p>
            </div>
          </div>
          <div className={`w-12 h-7 rounded-full p-0.5 transition-all ${notifEnabled ? "bg-nba-green" : "bg-secondary"}`}>
            <motion.div
              animate={{ x: notifEnabled ? 20 : 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="w-6 h-6 rounded-full bg-white shadow-md"
            />
          </div>
        </button>
      </motion.div>

      {/* Unit Calculator */}
      <UnitCalculatorSection />

      {/* Profit Display Mode */}
      <ProfitDisplayModeSection />

      {/* Contact Us */}
      <ContactUsSection />

      {/* Delete Account */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.39 }} className="relative z-10">
        <button
          onClick={() => setDeleteOpen(true)}
          className="w-full vision-card px-5 py-4 flex items-center gap-3 hover:bg-destructive/5 transition-colors"
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-destructive/15">
            <Trash2 className="w-4 h-4 text-destructive" />
          </div>
          <div className="text-left flex-1">
            <p className="text-[13px] font-bold text-destructive">Delete Account</p>
            <p className="text-[9px] text-muted-foreground/55">Permanently delete your Sentinel account and data</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground/55" />
        </button>
      </motion.div>

      <AlertDialog open={deleteOpen} onOpenChange={(o) => !deleting && setDeleteOpen(o)}>
        <AlertDialogContent className="max-w-md mx-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your Sentinel account?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <span className="block">
                This permanently deletes your account and associated data. This action cannot be undone.
              </span>
              <span className="block font-semibold text-foreground">
                Deleting your account does not cancel your Apple subscription.
              </span>
              <span className="block">
                Cancel or manage your subscription in the App Store first to avoid further billing.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <button
            type="button"
            onClick={() => void openExternal(MANAGE_SUBSCRIPTION_URL)}
            className="text-[12px] underline underline-offset-2 text-accent self-start"
          >
            Manage Subscription
          </button>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep account</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteAccount();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Deleting…
                </span>
              ) : (
                "Delete account"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sign Out */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="relative z-10">
        <button
          onClick={handleSignOut}
          className="w-full vision-card px-5 py-4 flex items-center justify-center gap-2 text-destructive hover:bg-destructive/5 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-[13px] font-bold">Sign Out</span>
        </button>
      </motion.div>

      {saving && (
        <div className="fixed left-1/2 -translate-x-1/2 z-50" style={{ bottom: "calc(env(safe-area-inset-bottom) + 6rem)" }}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-4 py-2 rounded-full text-[11px] font-bold text-accent-foreground flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))' }}
          >
            <Check className="w-3 h-3" /> Saved
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
