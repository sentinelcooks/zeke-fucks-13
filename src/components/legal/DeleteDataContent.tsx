const DeleteDataContent = () => (
  <div className="space-y-5 text-xs text-muted-foreground leading-relaxed">
    <p className="text-foreground/80 font-medium">
      Users may request deletion of their Sentinel account and associated personal data by using the in-app deletion feature or by contacting{" "}
      <a href="mailto:privacy@sentinelprops.com" className="text-accent hover:underline">privacy@sentinelprops.com</a>.
    </p>

    <p>
      Please note that certain information may be retained where required by law, for fraud prevention, to complete transactions, enforce agreements, or maintain necessary business records.
    </p>

    <p className="text-accent font-semibold">
      Deleting your account may result in permanent loss of saved picks, alerts, preferences, subscription history, and other account-related content associated with Sentinel.
    </p>
  </div>
);

export default DeleteDataContent;
