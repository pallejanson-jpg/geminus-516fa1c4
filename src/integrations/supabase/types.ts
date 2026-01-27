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
      annotation_symbols: {
        Row: {
          category: string
          color: string
          created_at: string
          icon_url: string | null
          id: string
          is_default: boolean
          marker_html: string | null
          name: string
          symbol_id: number | null
          updated_at: string
        }
        Insert: {
          category: string
          color?: string
          created_at?: string
          icon_url?: string | null
          id?: string
          is_default?: boolean
          marker_html?: string | null
          name: string
          symbol_id?: number | null
          updated_at?: string
        }
        Update: {
          category?: string
          color?: string
          created_at?: string
          icon_url?: string | null
          id?: string
          is_default?: boolean
          marker_html?: string | null
          name?: string
          symbol_id?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      asset_sync_state: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          last_sync_completed_at: string | null
          last_sync_started_at: string | null
          subtree_id: string
          subtree_name: string | null
          sync_status: string | null
          total_assets: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_completed_at?: string | null
          last_sync_started_at?: string | null
          subtree_id: string
          subtree_name?: string | null
          sync_status?: string | null
          total_assets?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_completed_at?: string | null
          last_sync_started_at?: string | null
          subtree_id?: string
          subtree_name?: string | null
          sync_status?: string | null
          total_assets?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      assets: {
        Row: {
          annotation_model_id: string | null
          annotation_placed: boolean | null
          asset_type: string | null
          attributes: Json | null
          building_fm_guid: string | null
          category: string
          common_name: string | null
          complex_common_name: string | null
          coordinate_x: number | null
          coordinate_y: number | null
          coordinate_z: number | null
          created_at: string
          created_in_model: boolean | null
          fm_guid: string
          gross_area: number | null
          id: string
          in_room_fm_guid: string | null
          is_local: boolean
          level_fm_guid: string | null
          name: string | null
          source_updated_at: string | null
          symbol_id: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          annotation_model_id?: string | null
          annotation_placed?: boolean | null
          asset_type?: string | null
          attributes?: Json | null
          building_fm_guid?: string | null
          category: string
          common_name?: string | null
          complex_common_name?: string | null
          coordinate_x?: number | null
          coordinate_y?: number | null
          coordinate_z?: number | null
          created_at?: string
          created_in_model?: boolean | null
          fm_guid: string
          gross_area?: number | null
          id?: string
          in_room_fm_guid?: string | null
          is_local?: boolean
          level_fm_guid?: string | null
          name?: string | null
          source_updated_at?: string | null
          symbol_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          annotation_model_id?: string | null
          annotation_placed?: boolean | null
          asset_type?: string | null
          attributes?: Json | null
          building_fm_guid?: string | null
          category?: string
          common_name?: string | null
          complex_common_name?: string | null
          coordinate_x?: number | null
          coordinate_y?: number | null
          coordinate_z?: number | null
          created_at?: string
          created_in_model?: boolean | null
          fm_guid?: string
          gross_area?: number | null
          id?: string
          in_room_fm_guid?: string | null
          is_local?: boolean
          level_fm_guid?: string | null
          name?: string | null
          source_updated_at?: string | null
          symbol_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_symbol_id_fkey"
            columns: ["symbol_id"]
            isOneToOne: false
            referencedRelation: "annotation_symbols"
            referencedColumns: ["id"]
          },
        ]
      }
      building_settings: {
        Row: {
          created_at: string
          fm_guid: string
          id: string
          is_favorite: boolean
          ivion_site_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          fm_guid: string
          id?: string
          is_favorite?: boolean
          ivion_site_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          fm_guid?: string
          id?: string
          is_favorite?: boolean
          ivion_site_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      faciliate_sync_state: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          last_sync_completed_at: string | null
          last_sync_started_at: string | null
          sync_status: string | null
          sync_type: string
          total_items: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_completed_at?: string | null
          last_sync_started_at?: string | null
          sync_status?: string | null
          sync_type?: string
          total_items?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_completed_at?: string | null
          last_sync_started_at?: string | null
          sync_status?: string | null
          sync_type?: string
          total_items?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      work_orders: {
        Row: {
          actual_cost: number | null
          assigned_to: string | null
          attributes: Json | null
          building_fm_guid: string | null
          building_name: string | null
          category: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          estimated_cost: number | null
          external_id: string
          guid: string | null
          id: string
          priority: string | null
          reported_at: string | null
          reported_by: string | null
          source_updated_at: string | null
          space_fm_guid: string | null
          space_name: string | null
          status: string
          synced_at: string
          title: string
          updated_at: string
        }
        Insert: {
          actual_cost?: number | null
          assigned_to?: string | null
          attributes?: Json | null
          building_fm_guid?: string | null
          building_name?: string | null
          category?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          estimated_cost?: number | null
          external_id: string
          guid?: string | null
          id?: string
          priority?: string | null
          reported_at?: string | null
          reported_by?: string | null
          source_updated_at?: string | null
          space_fm_guid?: string | null
          space_name?: string | null
          status?: string
          synced_at?: string
          title: string
          updated_at?: string
        }
        Update: {
          actual_cost?: number | null
          assigned_to?: string | null
          attributes?: Json | null
          building_fm_guid?: string | null
          building_name?: string | null
          category?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          estimated_cost?: number | null
          external_id?: string
          guid?: string | null
          id?: string
          priority?: string | null
          reported_at?: string | null
          reported_by?: string | null
          source_updated_at?: string | null
          space_fm_guid?: string | null
          space_name?: string | null
          status?: string
          synced_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      xkt_models: {
        Row: {
          building_fm_guid: string
          building_name: string | null
          created_at: string
          file_name: string
          file_size: number | null
          file_url: string | null
          id: string
          model_id: string
          model_name: string | null
          source_url: string | null
          storage_path: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          building_fm_guid: string
          building_name?: string | null
          created_at?: string
          file_name: string
          file_size?: number | null
          file_url?: string | null
          id?: string
          model_id: string
          model_name?: string | null
          source_url?: string | null
          storage_path: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          building_fm_guid?: string
          building_name?: string | null
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_url?: string | null
          id?: string
          model_id?: string
          model_name?: string | null
          source_url?: string | null
          storage_path?: string
          synced_at?: string
          updated_at?: string
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
