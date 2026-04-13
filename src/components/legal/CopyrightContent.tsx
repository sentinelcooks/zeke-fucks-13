const CopyrightContent = () => (
  <div className="space-y-5 text-xs text-muted-foreground leading-relaxed">
    <p className="text-foreground/80 font-medium">
      Sentinel respects intellectual property rights.
    </p>

    <p>
      If you believe content available through Sentinel infringes your copyright or other rights, please send a notice to{" "}
      <a href="mailto:copyright@sentinelprops.com" className="text-accent hover:underline">copyright@sentinelprops.com</a> including:
    </p>

    <ul className="list-disc list-inside space-y-2 ml-1">
      <li>Your name and contact information.</li>
      <li>A description of the work allegedly infringed.</li>
      <li>The location of the allegedly infringing material.</li>
      <li>A statement that you have a good-faith belief the use is unauthorized.</li>
      <li>A statement that the information in your notice is accurate and that you are authorized to act.</li>
    </ul>

    <p className="text-accent font-semibold">
      Sentinel may remove or disable access to content where appropriate.
    </p>
  </div>
);

export default CopyrightContent;
