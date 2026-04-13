import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Send, CheckCircle, Loader2 } from "lucide-react";

const ContactContent = () => {
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
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email)) {
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
    setTimeout(() => {
      setSent(false);
      setForm({ name: "", email: "", subject: "", message: "" });
    }, 300);
  };

  return (
    <div className="space-y-5 text-xs text-muted-foreground leading-relaxed">
      <p className="text-foreground/80 font-medium">
        For support, privacy requests, legal notices, or general questions, contact Sentinel at:
      </p>

      <div className="bg-secondary/40 rounded-xl p-3 space-y-2 break-all">
        <p><strong className="text-foreground">Support:</strong>{" "}<a href="mailto:support@sentinelprops.com" className="text-accent hover:underline">support@sentinelprops.com</a></p>
        <p><strong className="text-foreground">Privacy:</strong>{" "}<a href="mailto:privacy@sentinelprops.com" className="text-accent hover:underline">privacy@sentinelprops.com</a></p>
        <p><strong className="text-foreground">Legal:</strong>{" "}<a href="mailto:legal@sentinelprops.com" className="text-accent hover:underline">legal@sentinelprops.com</a></p>
      </div>

      <Button
        onClick={() => setOpen(true)}
        className="w-full bg-accent hover:bg-accent/90 text-accent-foreground font-semibold rounded-xl h-11 gap-2"
      >
        <Send className="w-4 h-4" />
        Contact Us
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="bg-card border-border/50 rounded-2xl max-w-md mx-auto p-0 overflow-hidden">
          <div className="p-6">
            <DialogHeader className="mb-5">
              <DialogTitle className="text-lg font-bold text-foreground">Get in Touch</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Send us a message and we'll get back to you as soon as possible.
              </DialogDescription>
            </DialogHeader>

            {sent ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                <CheckCircle className="w-12 h-12 text-green-400" />
                <p className="text-foreground font-semibold text-base">Message Sent!</p>
                <p className="text-muted-foreground text-xs">We'll review your message and respond shortly.</p>
                <Button variant="ghost" onClick={handleClose} className="mt-2 text-xs text-accent">
                  Close
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-xs text-muted-foreground">Name</Label>
                  <Input id="name" name="name" placeholder="Your name" value={form.name} onChange={handleChange} maxLength={100} className="bg-secondary/50 border-border/40 rounded-xl h-10 text-sm placeholder:text-muted-foreground/50" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs text-muted-foreground">Email</Label>
                  <Input id="email" name="email" type="email" placeholder="you@email.com" value={form.email} onChange={handleChange} maxLength={255} className="bg-secondary/50 border-border/40 rounded-xl h-10 text-sm placeholder:text-muted-foreground/50" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="subject" className="text-xs text-muted-foreground">Subject</Label>
                  <Input id="subject" name="subject" placeholder="What's this about?" value={form.subject} onChange={handleChange} maxLength={200} className="bg-secondary/50 border-border/40 rounded-xl h-10 text-sm placeholder:text-muted-foreground/50" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="message" className="text-xs text-muted-foreground">Message</Label>
                  <Textarea id="message" name="message" placeholder="Tell us more..." value={form.message} onChange={handleChange} maxLength={2000} rows={4} className="bg-secondary/50 border-border/40 rounded-xl text-sm placeholder:text-muted-foreground/50 resize-none" />
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
    </div>
  );
};

export default ContactContent;
