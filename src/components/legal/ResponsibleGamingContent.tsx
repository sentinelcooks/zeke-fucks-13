const ResponsibleGamingContent = () => (
  <div className="space-y-5 text-xs text-muted-foreground leading-relaxed">
    <p className="text-foreground/80 font-medium">
      If you choose to participate in sports wagering where legal, please do so responsibly.
    </p>

    <ul className="list-disc list-inside space-y-2 ml-1">
      <li>Never wager more than you can afford to lose.</li>
      <li>Do not chase losses.</li>
      <li>Set personal time and spending limits.</li>
      <li>Take breaks and seek help if gambling stops being entertainment.</li>
    </ul>

    <p className="text-accent font-semibold">
      Sentinel encourages responsible and lawful use at all times and is not responsible for any losses.
    </p>

    <div className="mt-4 p-3 rounded-xl border border-accent/20 bg-accent/5 text-center">
      <p className="text-[11px] text-muted-foreground mb-1">Need help? Call</p>
      <a
        href="tel:1-800-426-2537"
        className="text-base font-bold text-accent hover:text-accent/80 tracking-wide transition-colors"
      >
        1-800-GAMBLER
      </a>
      <p className="text-[10px] text-muted-foreground/60 mt-1">Free, confidential, 24/7</p>
    </div>
  </div>
);

export default ResponsibleGamingContent;
