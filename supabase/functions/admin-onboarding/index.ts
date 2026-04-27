import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { password, action } = body;
    const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET_PASSWORD");
    if (!ADMIN_SECRET || password !== ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (action === "list_responses") {
      const { data, error } = await supabaseAdmin
        .from("onboarding_responses")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const userIds = (data || []).map((r: any) => r.user_id);
      const profiles: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: profileData } = await supabaseAdmin
          .from("profiles")
          .select("id, email, display_name")
          .in("id", userIds);
        (profileData || []).forEach((p: any) => { profiles[p.id] = p; });
      }

      const enriched = (data || []).map((r: any) => ({
        ...r,
        email: profiles[r.user_id]?.email || null,
        display_name: profiles[r.user_id]?.display_name || null,
      }));

      return new Response(JSON.stringify({ responses: enriched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list_edge_history") {
      const { start_date, end_date, sport } = body;
      let q = supabaseAdmin
        .from("daily_picks")
        .select("*")
        .eq("tier", "edge")
        .neq("status", "empty_slate")
        .order("pick_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (start_date) q = q.gte("pick_date", start_date);
      if (end_date) q = q.lte("pick_date", end_date);
      if (sport && sport !== "all") q = q.eq("sport", sport);

      const { data, error } = await q;
      if (error) throw error;
      const picks = data || [];

      let wins = 0, losses = 0, pushes = 0, pending = 0;
      for (const p of picks) {
        const r = (p.result || "pending").toLowerCase();
        if (r === "hit" || r === "win") wins++;
        else if (r === "miss" || r === "loss") losses++;
        else if (r === "push") pushes++;
        else pending++;
      }
      const resolved = wins + losses;
      const hit_rate = resolved > 0 ? (wins / resolved) * 100 : 0;

      // Streak: walk picks in chronological order (oldest first), skip pushes/pending
      const chrono = [...picks].reverse();
      let streakType: "W" | "L" | null = null;
      let streakCount = 0;
      for (const p of chrono) {
        const r = (p.result || "").toLowerCase();
        let t: "W" | "L" | null = null;
        if (r === "hit" || r === "win") t = "W";
        else if (r === "miss" || r === "loss") t = "L";
        else continue;
        if (streakType === t) streakCount++;
        else { streakType = t; streakCount = 1; }
      }

      return new Response(JSON.stringify({
        picks,
        stats: {
          total: picks.length,
          resolved,
          wins,
          losses,
          pushes,
          pending,
          hit_rate,
          current_streak: streakType ? { type: streakType, count: streakCount } : null,
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "list_picks_history") {
      const { start_date, end_date, sport } = body;
      let q = supabaseAdmin
        .from("daily_picks")
        .select("*")
        .neq("tier", "edge")
        .not("tier", "in", "(pass,_pending)")
        .neq("status", "empty_slate")
        .order("pick_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (start_date) q = q.gte("pick_date", start_date);
      if (end_date) q = q.lte("pick_date", end_date);
      if (sport && sport !== "all") q = q.eq("sport", sport);

      const { data, error } = await q;
      if (error) throw error;
      const picks = data || [];

      let wins = 0, losses = 0, pushes = 0, pending = 0;
      for (const p of picks) {
        const r = (p.result || "pending").toLowerCase();
        if (r === "hit" || r === "win") wins++;
        else if (r === "miss" || r === "loss") losses++;
        else if (r === "push") pushes++;
        else pending++;
      }
      const resolved = wins + losses;
      const hit_rate = resolved > 0 ? (wins / resolved) * 100 : 0;

      const chrono = [...picks].reverse();
      let streakType: "W" | "L" | null = null;
      let streakCount = 0;
      for (const p of chrono) {
        const r = (p.result || "").toLowerCase();
        let t: "W" | "L" | null = null;
        if (r === "hit" || r === "win") t = "W";
        else if (r === "miss" || r === "loss") t = "L";
        else continue;
        if (streakType === t) streakCount++;
        else { streakType = t; streakCount = 1; }
      }

      return new Response(JSON.stringify({
        picks,
        stats: {
          total: picks.length,
          resolved,
          wins,
          losses,
          pushes,
          pending,
          hit_rate,
          current_streak: streakType ? { type: streakType, count: streakCount } : null,
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update_edge_result") {
      const { pick_id, result } = body;
      const allowed = ["hit", "miss", "push", "pending"];
      if (!pick_id || !allowed.includes(result)) {
        return new Response(JSON.stringify({ error: "Invalid pick_id or result" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await supabaseAdmin
        .from("daily_picks")
        .update({ result })
        .eq("id", pick_id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
