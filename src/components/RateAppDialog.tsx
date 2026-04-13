import { Star, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface RateAppDialogProps {
  open: boolean;
  onClose: () => void;
}

export function RateAppDialog({ open, onClose }: RateAppDialogProps) {
  const handleRate = () => {
    window.open("https://apps.apple.com", "_blank");
    localStorage.setItem("sentinel_rate_dismissed", "true");
    onClose();
  };

  const handleDismiss = () => {
    localStorage.setItem("sentinel_rate_dismissed", "true");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleDismiss()}>
      <DialogContent className="max-w-[360px] rounded-2xl border-yellow-500/20 bg-card p-6 text-center">
        <DialogHeader className="items-center">
          <div className="flex justify-center gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                className="w-7 h-7 fill-yellow-400 text-yellow-400 drop-shadow-[0_0_6px_hsla(45,100%,60%,0.4)]"
              />
            ))}
          </div>
          <DialogTitle className="text-base font-extrabold text-foreground">
            Enjoying Sentinel?
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground/60 leading-relaxed">
            Give us a 5-star review on the App Store — it helps us keep building!
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 mt-2">
          <button
            onClick={handleRate}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-yellow-500/15 border border-yellow-500/25 text-yellow-400 text-sm font-bold hover:bg-yellow-500/25 transition-colors"
          >
            <Star className="w-4 h-4 fill-yellow-400" /> Rate on App Store
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleDismiss}
            className="text-sm text-muted-foreground/50 hover:text-muted-foreground transition-colors py-1"
          >
            Not Now
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
