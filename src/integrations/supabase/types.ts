export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_whitelist_ips: {
        Row: {
          created_at: string
          id: string
          ip_address: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string
        }
        Relationships: []
      }
      contact_submissions: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          subject: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          subject: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          subject?: string
        }
        Relationships: []
      }
      correlated_props: {
        Row: {
          correlated_line: number | null
          correlated_player: string
          correlated_prop: string
          correlated_team: string | null
          created_at: string
          hit_rate: number
          id: string
          prop_date: string
          sample_size: number
          source_player: string
          source_prop: string
          sport: string
        }
        Insert: {
          correlated_line?: number | null
          correlated_player: string
          correlated_prop: string
          correlated_team?: string | null
          created_at?: string
          hit_rate?: number
          id?: string
          prop_date?: string
          sample_size?: number
          source_player: string
          source_prop: string
          sport?: string
        }
        Update: {
          correlated_line?: number | null
          correlated_player?: string
          correlated_prop?: string
          correlated_team?: string | null
          created_at?: string
          hit_rate?: number
          id?: string
          prop_date?: string
          sample_size?: number
          source_player?: string
          source_prop?: string
          sport?: string
        }
        Relationships: []
      }
      daily_picks: {
        Row: {
          avg_value: number | null
          away_team: string | null
          bet_type: string
          created_at: string
          direction: string
          hit_rate: number
          home_team: string | null
          id: string
          last_n_games: number
          line: number
          odds: string | null
          opponent: string | null
          pick_date: string
          player_name: string
          prop_type: string
          reasoning: string | null
          result: string | null
          sport: string
          spread_line: number | null
          team: string | null
          total_line: number | null
        }
        Insert: {
          avg_value?: number | null
          away_team?: string | null
          bet_type?: string
          created_at?: string
          direction?: string
          hit_rate?: number
          home_team?: string | null
          id?: string
          last_n_games?: number
          line: number
          odds?: string | null
          opponent?: string | null
          pick_date?: string
          player_name: string
          prop_type: string
          reasoning?: string | null
          result?: string | null
          sport?: string
          spread_line?: number | null
          team?: string | null
          total_line?: number | null
        }
        Update: {
          avg_value?: number | null
          away_team?: string | null
          bet_type?: string
          created_at?: string
          direction?: string
          hit_rate?: number
          home_team?: string | null
          id?: string
          last_n_games?: number
          line?: number
          odds?: string | null
          opponent?: string | null
          pick_date?: string
          player_name?: string
          prop_type?: string
          reasoning?: string | null
          result?: string | null
          sport?: string
          spread_line?: number | null
          team?: string | null
          total_line?: number | null
        }
        Relationships: []
      }
      fingerprint_log: {
        Row: {
          device_fingerprint: string
          id: string
          ip_address: string | null
          license_key_id: string
          logged_at: string
          user_agent: string | null
        }
        Insert: {
          device_fingerprint: string
          id?: string
          ip_address?: string | null
          license_key_id: string
          logged_at?: string
          user_agent?: string | null
        }
        Update: {
          device_fingerprint?: string
          id?: string
          ip_address?: string | null
          license_key_id?: string
          logged_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fingerprint_log_license_key_id_fkey"
            columns: ["license_key_id"]
            isOneToOne: false
            referencedRelation: "license_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      free_props: {
        Row: {
          book: string | null
          confidence: number | null
          created_at: string
          direction: string
          edge: number | null
          id: string
          line: number
          odds: number | null
          opponent: string | null
          player_name: string
          prop_date: string
          prop_type: string
          sport: string
          team: string | null
        }
        Insert: {
          book?: string | null
          confidence?: number | null
          created_at?: string
          direction?: string
          edge?: number | null
          id?: string
          line: number
          odds?: number | null
          opponent?: string | null
          player_name: string
          prop_date?: string
          prop_type: string
          sport?: string
          team?: string | null
        }
        Update: {
          book?: string | null
          confidence?: number | null
          created_at?: string
          direction?: string
          edge?: number | null
          id?: string
          line?: number
          odds?: number | null
          opponent?: string | null
          player_name?: string
          prop_date?: string
          prop_type?: string
          sport?: string
          team?: string | null
        }
        Relationships: []
      }
      key_sessions: {
        Row: {
          created_at: string
          device_fingerprint: string
          id: string
          ip_address: string | null
          ip_hash: string
          is_blocked: boolean
          last_seen_at: string
          license_key_id: string
          session_token: string | null
          token_expires_at: string | null
          ua_hash: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          device_fingerprint: string
          id?: string
          ip_address?: string | null
          ip_hash: string
          is_blocked?: boolean
          last_seen_at?: string
          license_key_id: string
          session_token?: string | null
          token_expires_at?: string | null
          ua_hash: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          device_fingerprint?: string
          id?: string
          ip_address?: string | null
          ip_hash?: string
          is_blocked?: boolean
          last_seen_at?: string
          license_key_id?: string
          session_token?: string | null
          token_expires_at?: string | null
          ua_hash?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "key_sessions_license_key_id_fkey"
            columns: ["license_key_id"]
            isOneToOne: false
            referencedRelation: "license_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      license_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          key: string
          label: string | null
          max_devices: number
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key: string
          label?: string | null
          max_devices?: number
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key?: string
          label?: string | null
          max_devices?: number
        }
        Relationships: []
      }
      login_attempts: {
        Row: {
          attempted_at: string
          id: string
          ip_address: string
          success: boolean
        }
        Insert: {
          attempted_at?: string
          id?: string
          ip_address: string
          success?: boolean
        }
        Update: {
          attempted_at?: string
          id?: string
          ip_address?: string
          success?: boolean
        }
        Relationships: []
      }
      mlb_predictions: {
        Row: {
          bet_type: string
          confidence: number
          created_at: string
          game_id: string
          id: string
          prediction: Json
          prediction_date: string
          result: string | null
          verdict: string
        }
        Insert: {
          bet_type: string
          confidence?: number
          created_at?: string
          game_id: string
          id?: string
          prediction?: Json
          prediction_date?: string
          result?: string | null
          verdict?: string
        }
        Update: {
          bet_type?: string
          confidence?: number
          created_at?: string
          game_id?: string
          id?: string
          prediction?: Json
          prediction_date?: string
          result?: string | null
          verdict?: string
        }
        Relationships: []
      }
      nhl_predictions: {
        Row: {
          bet_type: string
          confidence: number
          created_at: string
          game_id: string
          id: string
          prediction: Json
          prediction_date: string
          result: string | null
          verdict: string
        }
        Insert: {
          bet_type: string
          confidence?: number
          created_at?: string
          game_id: string
          id?: string
          prediction?: Json
          prediction_date?: string
          result?: string | null
          verdict?: string
        }
        Update: {
          bet_type?: string
          confidence?: number
          created_at?: string
          game_id?: string
          id?: string
          prediction?: Json
          prediction_date?: string
          result?: string | null
          verdict?: string
        }
        Relationships: []
      }
      odds_api_keys: {
        Row: {
          api_key: string
          created_at: string
          exhausted_at: string | null
          id: string
          is_active: boolean
          last_error: string | null
          last_used_at: string | null
          requests_remaining: number | null
          requests_used: number | null
        }
        Insert: {
          api_key: string
          created_at?: string
          exhausted_at?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_used_at?: string | null
          requests_remaining?: number | null
          requests_used?: number | null
        }
        Update: {
          api_key?: string
          created_at?: string
          exhausted_at?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_used_at?: string | null
          requests_remaining?: number | null
          requests_used?: number | null
        }
        Relationships: []
      }
      onboarding_responses: {
        Row: {
          ai_recommendations: Json | null
          betting_style: string | null
          created_at: string
          id: string
          referral: string | null
          sports: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_recommendations?: Json | null
          betting_style?: string | null
          created_at?: string
          id?: string
          referral?: string | null
          sports?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_recommendations?: Json | null
          betting_style?: string | null
          created_at?: string
          id?: string
          referral?: string | null
          sports?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      outcomes: {
        Row: {
          actual_result: string
          actual_value: number | null
          created_at: string
          direction: string | null
          id: string
          line: number | null
          player_or_team: string
          predicted_confidence: number | null
          profit_loss: number | null
          prop_type: string | null
          snapshot_id: string | null
          sport: string
          user_id: string | null
        }
        Insert: {
          actual_result: string
          actual_value?: number | null
          created_at?: string
          direction?: string | null
          id?: string
          line?: number | null
          player_or_team: string
          predicted_confidence?: number | null
          profit_loss?: number | null
          prop_type?: string | null
          snapshot_id?: string | null
          sport: string
          user_id?: string | null
        }
        Update: {
          actual_result?: string
          actual_value?: number | null
          created_at?: string
          direction?: string | null
          id?: string
          line?: number | null
          player_or_team?: string
          predicted_confidence?: number | null
          profit_loss?: number | null
          prop_type?: string | null
          snapshot_id?: string | null
          sport?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outcomes_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "prediction_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      parlay_history: {
        Row: {
          created_at: string
          id: string
          legs: Json
          overall_confidence: number
          overall_grade: string
          overall_writeup: string | null
          parlay_odds: number
          potential_payout: number
          profit: number
          result: string
          stake: number
          unit_sizing: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          legs?: Json
          overall_confidence?: number
          overall_grade?: string
          overall_writeup?: string | null
          parlay_odds?: number
          potential_payout?: number
          profit?: number
          result?: string
          stake?: number
          unit_sizing?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          legs?: Json
          overall_confidence?: number
          overall_grade?: string
          overall_writeup?: string | null
          parlay_odds?: number
          potential_payout?: number
          profit?: number
          result?: string
          stake?: number
          unit_sizing?: string | null
          user_id?: string
        }
        Relationships: []
      }
      pick_history: {
        Row: {
          direction: string
          hit_rate: number
          id: string
          license_key: string
          line: number
          odds: string | null
          pick_date: string
          pick_id: string | null
          player_name: string
          prop_type: string
          reasoning: string | null
          result: string | null
          saved_at: string
          sport: string
          user_id: string | null
        }
        Insert: {
          direction: string
          hit_rate?: number
          id?: string
          license_key: string
          line: number
          odds?: string | null
          pick_date: string
          pick_id?: string | null
          player_name: string
          prop_type: string
          reasoning?: string | null
          result?: string | null
          saved_at?: string
          sport?: string
          user_id?: string | null
        }
        Update: {
          direction?: string
          hit_rate?: number
          id?: string
          license_key?: string
          line?: number
          odds?: string | null
          pick_date?: string
          pick_id?: string | null
          player_name?: string
          prop_type?: string
          reasoning?: string | null
          result?: string | null
          saved_at?: string
          sport?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pick_history_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "daily_picks"
            referencedColumns: ["id"]
          },
        ]
      }
      plays: {
        Row: {
          bet_type: string
          created_at: string
          id: string
          license_key: string
          line: number | null
          notes: string | null
          odds: number
          payout: number | null
          player_or_fighter: string
          result: string
          sport: string
          stake: number
          user_id: string | null
        }
        Insert: {
          bet_type: string
          created_at?: string
          id?: string
          license_key: string
          line?: number | null
          notes?: string | null
          odds?: number
          payout?: number | null
          player_or_fighter: string
          result?: string
          sport?: string
          stake?: number
          user_id?: string | null
        }
        Update: {
          bet_type?: string
          created_at?: string
          id?: string
          license_key?: string
          line?: number | null
          notes?: string | null
          odds?: number
          payout?: number | null
          player_or_fighter?: string
          result?: string
          sport?: string
          stake?: number
          user_id?: string | null
        }
        Relationships: []
      }
      prediction_snapshots: {
        Row: {
          actual_outcome: string | null
          confidence: number
          created_at: string
          data_quality: string | null
          direction: string | null
          ev_percent: number | null
          game_environment: Json | null
          id: string
          injury_flags: Json | null
          line: number | null
          lineup_confirmed: boolean | null
          market_type: string
          odds_at_time: number | null
          outcome_logged_at: string | null
          outcome_value: number | null
          player_or_team: string
          prop_type: string | null
          sport: string
          top_factors: Json | null
          unit_size: number | null
          user_id: string | null
          variance_level: string | null
          verdict: string | null
        }
        Insert: {
          actual_outcome?: string | null
          confidence: number
          created_at?: string
          data_quality?: string | null
          direction?: string | null
          ev_percent?: number | null
          game_environment?: Json | null
          id?: string
          injury_flags?: Json | null
          line?: number | null
          lineup_confirmed?: boolean | null
          market_type: string
          odds_at_time?: number | null
          outcome_logged_at?: string | null
          outcome_value?: number | null
          player_or_team: string
          prop_type?: string | null
          sport: string
          top_factors?: Json | null
          unit_size?: number | null
          user_id?: string | null
          variance_level?: string | null
          verdict?: string | null
        }
        Update: {
          actual_outcome?: string | null
          confidence?: number
          created_at?: string
          data_quality?: string | null
          direction?: string | null
          ev_percent?: number | null
          game_environment?: Json | null
          id?: string
          injury_flags?: Json | null
          line?: number | null
          lineup_confirmed?: boolean | null
          market_type?: string
          odds_at_time?: number | null
          outcome_logged_at?: string | null
          outcome_value?: number | null
          player_or_team?: string
          prop_type?: string | null
          sport?: string
          top_factors?: Json | null
          unit_size?: number | null
          user_id?: string | null
          variance_level?: string | null
          verdict?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          display_name: string | null
          email: string | null
          id: string
          notification_enabled: boolean | null
          odds_format: string
          onboarding_complete: boolean
          timezone: string | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          id: string
          notification_enabled?: boolean | null
          odds_format?: string
          onboarding_complete?: boolean
          timezone?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          notification_enabled?: boolean | null
          odds_format?: string
          onboarding_complete?: boolean
          timezone?: string | null
        }
        Relationships: []
      }
      prop_explanations: {
        Row: {
          betting_level: string
          created_at: string
          example: string
          explanation: string
          id: string
          prop_value: string
          sport: string
        }
        Insert: {
          betting_level?: string
          created_at?: string
          example: string
          explanation: string
          id?: string
          prop_value: string
          sport?: string
        }
        Update: {
          betting_level?: string
          created_at?: string
          example?: string
          explanation?: string
          id?: string
          prop_value?: string
          sport?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string | null
          endpoint: string
          id: string
          keys: Json
          user_id: string
        }
        Insert: {
          created_at?: string | null
          endpoint: string
          id?: string
          keys: Json
          user_id: string
        }
        Update: {
          created_at?: string | null
          endpoint?: string
          id?: string
          keys?: Json
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
