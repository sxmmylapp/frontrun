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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      leaderboard_snapshots: {
        Row: {
          balance: number
          created_at: string | null
          id: string
          is_winner: boolean | null
          period_id: string
          rank: number
          user_id: string
        }
        Insert: {
          balance: number
          created_at?: string | null
          id?: string
          is_winner?: boolean | null
          period_id: string
          rank: number
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string | null
          id?: string
          is_winner?: boolean | null
          period_id?: string
          rank?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_snapshots_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "prize_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaderboard_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      market_pools: {
        Row: {
          market_id: string
          no_pool: number
          updated_at: string | null
          yes_pool: number
        }
        Insert: {
          market_id: string
          no_pool: number
          updated_at?: string | null
          yes_pool: number
        }
        Update: {
          market_id?: string
          no_pool?: number
          updated_at?: string | null
          yes_pool?: number
        }
        Relationships: [
          {
            foreignKeyName: "market_pools_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: true
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      markets: {
        Row: {
          closes_at: string
          created_at: string | null
          creator_id: string
          id: string
          question: string
          resolution_criteria: string
          resolved_at: string | null
          resolved_outcome: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          closes_at: string
          created_at?: string | null
          creator_id: string
          id?: string
          question: string
          resolution_criteria: string
          resolved_at?: string | null
          resolved_outcome?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          closes_at?: string
          created_at?: string | null
          creator_id?: string
          id?: string
          question?: string
          resolution_criteria?: string
          resolved_at?: string | null
          resolved_outcome?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "markets_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          cancelled_at: string | null
          cost: number
          created_at: string | null
          id: string
          market_id: string
          outcome: string
          shares: number
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          cost: number
          created_at?: string | null
          id?: string
          market_id: string
          outcome: string
          shares: number
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          cost?: number
          created_at?: string | null
          id?: string
          market_id?: string
          outcome?: string
          shares?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prize_periods: {
        Row: {
          created_at: string | null
          created_by: string
          id: string
          snapshot_at: string
          title: string
        }
        Insert: {
          created_at?: string | null
          created_by: string
          id?: string
          snapshot_at?: string
          title: string
        }
        Update: {
          created_at?: string | null
          created_by?: string
          id?: string
          snapshot_at?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "prize_periods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          banned_at: string | null
          created_at: string | null
          display_name: string
          id: string
          is_admin: boolean | null
          phone: string
          updated_at: string | null
        }
        Insert: {
          banned_at?: string | null
          created_at?: string | null
          display_name: string
          id: string
          is_admin?: boolean | null
          phone: string
          updated_at?: string | null
        }
        Update: {
          banned_at?: string | null
          created_at?: string | null
          display_name?: string
          id?: string
          is_admin?: boolean | null
          phone?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          event_id: string
          event_type: string
          id: string
          payment_intent_id: string | null
          processed_at: string | null
          status: string | null
        }
        Insert: {
          event_id: string
          event_type: string
          id?: string
          payment_intent_id?: string | null
          processed_at?: string | null
          status?: string | null
        }
        Update: {
          event_id?: string
          event_type?: string
          id?: string
          payment_intent_id?: string | null
          processed_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      token_ledger: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          reason: string
          reference_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          reason: string
          reference_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          reason?: string
          reference_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      token_purchases: {
        Row: {
          amount_cents: number
          completed_at: string | null
          created_at: string | null
          id: string
          status: string
          stripe_payment_intent_id: string
          tier: string
          tokens_credited: number
          user_id: string
        }
        Insert: {
          amount_cents: number
          completed_at?: string | null
          created_at?: string | null
          id?: string
          status?: string
          stripe_payment_intent_id: string
          tier: string
          tokens_credited: number
          user_id: string
        }
        Update: {
          amount_cents?: number
          completed_at?: string | null
          created_at?: string | null
          id?: string
          status?: string
          stripe_payment_intent_id?: string
          tier?: string
          tokens_credited?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "token_purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      user_balances: {
        Row: {
          balance: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "token_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      cancel_bet: {
        Args: { p_position_id: string; p_user_id: string }
        Returns: Json
      }
      cancel_market: {
        Args: { p_admin_id: string; p_market_id: string }
        Returns: Json
      }
      credit_token_purchase: {
        Args: {
          p_payment_intent_id: string
          p_tokens: number
          p_user_id: string
        }
        Returns: Json
      }
      generate_display_name: { Args: never; Returns: string }
      place_bet: {
        Args: {
          p_amount: number
          p_market_id: string
          p_outcome: string
          p_user_id: string
        }
        Returns: Json
      }
      resolve_market: {
        Args: { p_admin_id: string; p_market_id: string; p_outcome: string }
        Returns: Json
      }
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
