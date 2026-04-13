import { BarChart3, Crosshair, DollarSign, Layers, Flame, TrendingUp, Sparkles } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import logo from "@/assets/sentinel-logo.jpg";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Free Picks", url: "/dashboard/picks", icon: Flame },
  { title: "Free Props", url: "/dashboard/free-props", icon: Sparkles },
  { title: "NBA Props", url: "/dashboard/nba", icon: BarChart3 },
  { title: "Money Line", url: "/dashboard/moneyline", icon: TrendingUp },
  { title: "UFC Analysis", url: "/dashboard/ufc", icon: Crosshair },
  { title: "Parlay Builder", url: "/dashboard/parlay", icon: Layers },
  { title: "Profit Tracker", url: "/dashboard/tracker", icon: DollarSign },
  
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  return (
    <Sidebar collapsible="icon" className="border-r border-border">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Sentinel" className="w-9 h-9 rounded-lg shrink-0" />
          {!collapsed && (
            <div className="overflow-hidden">
              <h1 className="text-sm font-bold text-foreground truncate tracking-wide">Sentinel</h1>
              <p className="text-[10px] text-muted-foreground truncate">Sports Analytics</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="hover:bg-secondary/50"
                      activeClassName="bg-secondary text-accent font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
