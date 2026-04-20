import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, EyeOff, FileText, Gamepad2, CreditCard, Mail, Copyright, Trash2 } from "lucide-react";

const FOOTER_LINKS = [
  { label: "Privacy Policy", section: "privacy" },
  { label: "Terms of Use", section: "terms" },
  { label: "Disclaimer", section: "disclaimer" },
  { label: "Responsible Gaming", section: "responsible-gaming" },
  { label: "Refund Policy", section: "refund" },
  { label: "Copyright", section: "copyright" },
  { label: "Contact", section: "contact" },
  { label: "Delete Data", section: "delete-data" },
];

const AppFooter = () => {
  const navigate = useNavigate();

  return (
    <footer className="px-4 pt-8 pb-6 mt-4">
      <div className="h-px w-full mb-5" style={{ background: 'linear-gradient(90deg, transparent, hsla(228, 18%, 25%, 0.5), transparent)' }} />

      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5 mb-4">
        {FOOTER_LINKS.map((link) => (
          <button
            key={link.section}
            onClick={() => navigate("/dashboard/legal", { state: { section: link.section } })}
            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            {link.label}
          </button>
        ))}
      </div>

      <div className="text-center space-y-1.5">
        <p className="text-[9px] text-muted-foreground/35 font-medium tracking-wide">
          © {new Date().getFullYear()} Sentinel. All rights reserved.
        </p>
        <p className="text-[8px] text-muted-foreground/30 leading-snug max-w-[320px] mx-auto">
          Sentinel is a sports analysis tool. We are not a sportsbook, casino, or gambling operator. We do not accept wagers, guarantee wins, or provide financial advice. All analysis is for informational and entertainment purposes only. Users are solely responsible for their own decisions. Must be 18+.
        </p>
        <a href="tel:1-800-426-2537" className="text-[9px] text-muted-foreground/40 hover:text-accent transition-colors font-semibold">
          1-800-GAMBLER
        </a>
      </div>
    </footer>
  );
};

export default memo(AppFooter);
