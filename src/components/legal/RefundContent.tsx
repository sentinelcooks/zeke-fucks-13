const RefundContent = () => (
  <div className="space-y-5 text-xs text-muted-foreground leading-relaxed">
    <p className="text-accent font-semibold">
      All sales are final. Sentinel does not offer refunds for subscriptions, renewals, partially used billing periods, or unused access, except where required by law.
    </p>

    <p>
      For purchases made through Apple's App Store, Apple's billing and refund policies apply.
    </p>

    <p>
      For purchases made directly through Sentinel, by purchasing a subscription you acknowledge and agree that fees are <strong className="text-foreground">non-refundable</strong> once access begins.
    </p>
  </div>
);

export default RefundContent;
