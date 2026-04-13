const DisclaimerContent = () => (
  <div className="space-y-5 text-xs text-muted-foreground leading-relaxed">
    <p className="text-foreground/80 font-medium">
      Sentinel is a sports analytics and informational platform.
    </p>

    <p>
      All data, projections, trends, model outputs, and pick-related content are provided for{" "}
      <strong className="text-foreground">informational and entertainment purposes only</strong>.
    </p>

    <p>
      Sentinel does not guarantee winning outcomes, profits, or the accuracy or completeness of any information shown in the app.
    </p>

    <p className="text-accent font-semibold">
      Sentinel is not a sportsbook, bookmaker, casino, or gambling operator and does not accept or process wagers within the app unless expressly stated otherwise.
    </p>

    <p>
      Users are solely responsible for any actions they take based on information provided by Sentinel and for complying with all laws and regulations in their jurisdiction.
    </p>
  </div>
);

export default DisclaimerContent;
