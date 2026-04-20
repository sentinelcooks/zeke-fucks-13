import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Globe, Bell, BellOff, LogOut, User, Check, ChevronRight, Hash, MessageSquare, Send, Loader2, CheckCircle, CreditCard, Palette } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

const HOME_THEMES = [
  { value: "modern", label: "Modern", desc: "Today's Edge cards" },
  { value: "classic", label: "Classic", desc: "Stat cards + PNL" },
];

const SettingsPage = () => {
  const { profile, user, updateProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [selectedTz, setSelectedTz] = useState(profile?.timezone || "America/New_York");
  const [notifEnabled, setNotifEnabled] = useState(profile?.notification_enabled || false);
  const [oddsFormat, setOddsFormat] = useState<"american" | "decimal">(profile?.odds_format || "american");
  const [saving, setSaving] = useState(false);
  const [showTzPicker, setShowTzPicker] = useState(false);
  const [homeTheme, setHomeTheme] = useState<"modern" | "classic">(() => {
    return (localStorage.getItem("sentinel_home_theme") as "modern" | "classic") || "modern";
  });

  const handleHomeThemeChange = (theme: "modern" | "classic") => {
    setHomeTheme(theme);
    localStorage.setItem("sentinel_home_theme", theme);
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
    if (!notifEnabled && "Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
    }
    const newVal = !notifEnabled;
    setNotifEnabled(newVal);
    setSaving(true);
    await updateProfile({ notification_enabled: newVal });
    setSaving(false);
  };

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

  const currentTzLabel = TIMEZONES.find((t) => t.value === selectedTz)?.label || selectedTz;

  return (
    <div className="px-4 pt-2 pb-4 space-y-4 relative">
      <div className="vision-orb w-48 h-48 -top-10 -right-10" style={{ background: 'hsl(142 100% 50%)' }} />

      

      {/* Account */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="vision-card overflow-hidden relative z-10">
        <div className="px-5 py-3 border-b border-border/20">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">Account</span>
        </div>
        <div className="px-5 py-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))' }}>
            <User className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-foreground truncate">
              {profile?.display_name || user?.email?.split("@")[0] || "User"}
            </p>
            <p className="text-[10px] text-muted-foreground/65 truncate">{user?.email}</p>
          </div>
        </div>
      </motion.div>

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

      {/* Appearance */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="vision-card overflow-hidden relative z-10">
        <div className="px-5 py-3 border-b border-border/20">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">Appearance</span>
        </div>
        <div className="px-5 py-4 space-y-2">
          <div className="flex items-center gap-3 mb-3">
            <Palette className="w-5 h-5 text-accent/60" />
            <div>
              <p className="text-[13px] font-bold text-foreground">Home Screen Layout</p>
              <p className="text-[9px] text-muted-foreground/55">Choose your preferred dashboard style</p>
            </div>
          </div>
          <div className="flex rounded-xl p-1 gap-1" style={{
            background: 'hsla(228, 20%, 8%, 0.6)',
            border: '1px solid hsla(228, 30%, 16%, 0.25)',
          }}>
            {HOME_THEMES.map((t) => (
              <button
                key={t.value}
                onClick={() => handleHomeThemeChange(t.value as "modern" | "classic")}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-lg text-center transition-all duration-300 ${
                  homeTheme === t.value
                    ? "text-[hsl(228_30%_8%)]"
                    : "text-muted-foreground/65 hover:text-foreground/50"
                }`}
                style={homeTheme === t.value ? {
                  background: 'linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))',
                  boxShadow: '0 4px 12px -2px hsla(142,100%,50%,0.3)',
                } : {}}
              >
                <span className="text-[11px] font-bold tracking-wider">{t.label}</span>
                <span className={`text-[9px] font-semibold ${homeTheme === t.value ? "text-[hsl(228_30%_8%)]/75" : "text-muted-foreground/50"}`}>{t.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Contact Us */}
      <ContactUsSection />

      {/* Manage Subscription */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="relative z-10">
        <button
          onClick={() => navigate("/dashboard/paywall")}
          className="w-full vision-card px-5 py-4 flex items-center gap-3 hover:bg-secondary/20 transition-colors"
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))' }}>
            <CreditCard className="w-4 h-4 text-white" />
          </div>
          <div className="text-left flex-1">
            <p className="text-[13px] font-bold text-foreground">Manage Subscription</p>
            <p className="text-[9px] text-muted-foreground/55">View or update your plan</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground/55" />
        </button>
      </motion.div>

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
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50">
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
