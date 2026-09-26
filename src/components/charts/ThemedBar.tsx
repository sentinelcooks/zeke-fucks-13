import { useMemo, type ComponentProps } from "react";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS } from "chart.js";
import { useTheme } from "next-themes";
import { resolveCssVars, resolveCssVarsDeep } from "@/lib/themeColor";

type BarProps = ComponentProps<typeof Bar>;

/**
 * react-chartjs-2 <Bar> that understands theme tokens.
 * Chart.js draws on a canvas, which cannot read CSS variables, so every
 * `hsl(var(--token))` in data/options is resolved to a concrete color for the
 * current Light/Dark theme, and the chart redraws when the theme changes.
 */
export function ThemedBar({ data, options, ...rest }: BarProps) {
  const { resolvedTheme } = useTheme();

  const resolved = useMemo(() => {
    ChartJS.defaults.color = resolveCssVars("hsl(var(--muted-foreground))");
    ChartJS.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, sans-serif';
    return { data: resolveCssVarsDeep(data), options: resolveCssVarsDeep(options) };
    // resolvedTheme is a dependency on purpose: token values change with the theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, options, resolvedTheme]);

  return <Bar key={resolvedTheme} data={resolved.data} options={resolved.options} {...rest} />;
}
