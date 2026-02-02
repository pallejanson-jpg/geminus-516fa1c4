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
      asset_plus_endpoint_cache: {
        Row: {
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      asset_sync_progress: {
        Row: {
          building_fm_guid: string | null
          created_at: string | null
          current_building_index: number | null
          cursor_fm_guid: string | null
          job: string
          last_error: string | null
          page_mode: string | null
          skip: number | null
          total_buildings: number | null
          total_synced: number | null
          updated_at: string | null
        }
        Insert: {
          building_fm_guid?: string | null
          created_at?: string | null
          current_building_index?: number | null
          cursor_fm_guid?: string | null
          job: string
          last_error?: string | null
          page_mode?: string | null
          skip?: number | null
          total_buildings?: number | null
          total_synced?: number | null
          updated_at?: string | null
        }
        Update: {
          building_fm_guid?: string | null
          created_at?: string | null
          current_building_index?: number | null
          cursor_fm_guid?: string | null
          job?: string
          last_error?: string | null
          page_mode?: string | null
          skip?: number | null
          total_buildings?: number | null
          total_synced?: number | null
          updated_at?: string | null
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
          ivion_image_id: number | null
          ivion_poi_id: number | null
          ivion_site_id: string | null
          ivion_synced_at: string | null
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
          ivion_image_id?: number | null
          ivion_poi_id?: number | null
          ivion_site_id?: string | null
          ivion_synced_at?: string | null
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
          ivion_image_id?: number | null
          ivion_poi_id?: number | null
          ivion_site_id?: string | null
          ivion_synced_at?: string | null
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
      bcf_comments: {
        Row: {
          comment: string
          created_at: string
          id: string
          issue_id: string
          screenshot_url: string | null
          user_id: string
          viewpoint_json: Json | null
        }
        Insert: {
          comment: string
          created_at?: string
          id?: string
          issue_id: string
          screenshot_url?: string | null
          user_id: string
          viewpoint_json?: Json | null
        }
        Update: {
          comment?: string
          created_at?: string
          id?: string
          issue_id?: string
          screenshot_url?: string | null
          user_id?: string
          viewpoint_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "bcf_comments_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "bcf_issues"
            referencedColumns: ["id"]
          },
        ]
      }
      bcf_issues: {
        Row: {
          assigned_to: string | null
          building_fm_guid: string | null
          building_name: string | null
          created_at: string
          description: string | null
          id: string
          issue_type: string
          priority: string
          reported_by: string
          resolved_at: string | null
          resolved_by: string | null
          screenshot_url: string | null
          selected_object_ids: string[] | null
          status: string
          title: string
          updated_at: string
          viewpoint_json: Json | null
        }
        Insert: {
          assigned_to?: string | null
          building_fm_guid?: string | null
          building_name?: string | null
          created_at?: string
          description?: string | null
          id?: string
          issue_type?: string
          priority?: string
          reported_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          screenshot_url?: string | null
          selected_object_ids?: string[] | null
          status?: string
          title: string
          updated_at?: string
          viewpoint_json?: Json | null
        }
        Update: {
          assigned_to?: string | null
          building_fm_guid?: string | null
          building_name?: string | null
          created_at?: string
          description?: string | null
          id?: string
          issue_type?: string
          priority?: string
          reported_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          screenshot_url?: string | null
          selected_object_ids?: string[] | null
          status?: string
          title?: string
          updated_at?: string
          viewpoint_json?: Json | null
        }
        Relationships: []
      }
      building_external_links: {
        Row: {
          building_fm_guid: string
          created_at: string
          display_name: string | null
          external_id: string | null
          external_url: string
          id: string
          system_name: string
          updated_at: string
        }
        Insert: {
          building_fm_guid: string
          created_at?: string
          display_name?: string | null
          external_id?: string | null
          external_url: string
          id?: string
          system_name: string
          updated_at?: string
        }
        Update: {
          building_fm_guid?: string
          created_at?: string
          display_name?: string | null
          external_id?: string | null
          external_url?: string
          id?: string
          system_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      building_settings: {
        Row: {
          created_at: string
          fm_guid: string
          hero_image_url: string | null
          id: string
          is_favorite: boolean
          ivion_site_id: string | null
          latitude: number | null
          longitude: number | null
          start_view_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          fm_guid: string
          hero_image_url?: string | null
          id?: string
          is_favorite?: boolean
          ivion_site_id?: string | null
          latitude?: number | null
          longitude?: number | null
          start_view_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          fm_guid?: string
          hero_image_url?: string | null
          id?: string
          is_favorite?: boolean
          ivion_site_id?: string | null
          latitude?: number | null
          longitude?: number | null
          start_view_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_settings_start_view_id_fkey"
            columns: ["start_view_id"]
            isOneToOne: false
            referencedRelation: "saved_views"
            referencedColumns: ["id"]
          },
        ]
      }
      detection_templates: {
        Row: {
          ai_prompt: string
          created_at: string | null
          default_category: string | null
          default_symbol_id: string | null
          description: string | null
          example_images: string[] | null
          id: string
          is_active: boolean | null
          name: string
          object_type: string
          updated_at: string | null
        }
        Insert: {
          ai_prompt: string
          created_at?: string | null
          default_category?: string | null
          default_symbol_id?: string | null
          description?: string | null
          example_images?: string[] | null
          id?: string
          is_active?: boolean | null
          name: string
          object_type: string
          updated_at?: string | null
        }
        Update: {
          ai_prompt?: string
          created_at?: string | null
          default_category?: string | null
          default_symbol_id?: string | null
          description?: string | null
          example_images?: string[] | null
          id?: string
          is_active?: boolean | null
          name?: string
          object_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "detection_templates_default_symbol_id_fkey"
            columns: ["default_symbol_id"]
            isOneToOne: false
            referencedRelation: "annotation_symbols"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          building_fm_guid: string
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          metadata: Json
          mime_type: string | null
          source_id: string | null
          source_system: string
          source_url: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          building_fm_guid: string
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          source_id?: string | null
          source_system?: string
          source_url?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          building_fm_guid?: string
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          source_id?: string | null
          source_system?: string
          source_url?: string | null
          synced_at?: string
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
      onboarding_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          goals: string[] | null
          id: string
          role: string | null
          script_content: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          goals?: string[] | null
          id?: string
          role?: string | null
          script_content?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          goals?: string[] | null
          id?: string
          role?: string | null
          script_content?: string | null
          user_id?: string
        }
        Relationships: []
      }
      pending_detections: {
        Row: {
          ai_description: string | null
          bounding_box: Json
          building_fm_guid: string
          confidence: number
          coordinate_x: number | null
          coordinate_y: number | null
          coordinate_z: number | null
          created_asset_fm_guid: string | null
          created_at: string | null
          created_ivion_poi_id: number | null
          detection_template_id: string | null
          extracted_properties: Json | null
          id: string
          ivion_dataset_name: string | null
          ivion_image_id: number | null
          ivion_site_id: string
          object_type: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scan_job_id: string
          status: string | null
          thumbnail_url: string | null
        }
        Insert: {
          ai_description?: string | null
          bounding_box: Json
          building_fm_guid: string
          confidence: number
          coordinate_x?: number | null
          coordinate_y?: number | null
          coordinate_z?: number | null
          created_asset_fm_guid?: string | null
          created_at?: string | null
          created_ivion_poi_id?: number | null
          detection_template_id?: string | null
          extracted_properties?: Json | null
          id?: string
          ivion_dataset_name?: string | null
          ivion_image_id?: number | null
          ivion_site_id: string
          object_type: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_job_id: string
          status?: string | null
          thumbnail_url?: string | null
        }
        Update: {
          ai_description?: string | null
          bounding_box?: Json
          building_fm_guid?: string
          confidence?: number
          coordinate_x?: number | null
          coordinate_y?: number | null
          coordinate_z?: number | null
          created_asset_fm_guid?: string | null
          created_at?: string | null
          created_ivion_poi_id?: number | null
          detection_template_id?: string | null
          extracted_properties?: Json | null
          id?: string
          ivion_dataset_name?: string | null
          ivion_image_id?: number | null
          ivion_site_id?: string
          object_type?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scan_job_id?: string
          status?: string | null
          thumbnail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_detections_detection_template_id_fkey"
            columns: ["detection_template_id"]
            isOneToOne: false
            referencedRelation: "detection_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_detections_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "pending_detections_scan_job_id_fkey"
            columns: ["scan_job_id"]
            isOneToOne: false
            referencedRelation: "scan_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      room_label_configs: {
        Row: {
          click_action: string
          created_at: string | null
          fields: Json
          font_size: number
          height_offset: number
          id: string
          is_default: boolean
          name: string
          scale_with_distance: boolean
          updated_at: string | null
        }
        Insert: {
          click_action?: string
          created_at?: string | null
          fields?: Json
          font_size?: number
          height_offset?: number
          id?: string
          is_default?: boolean
          name: string
          scale_with_distance?: boolean
          updated_at?: string | null
        }
        Update: {
          click_action?: string
          created_at?: string | null
          fields?: Json
          font_size?: number
          height_offset?: number
          id?: string
          is_default?: boolean
          name?: string
          scale_with_distance?: boolean
          updated_at?: string | null
        }
        Relationships: []
      }
      saved_views: {
        Row: {
          building_fm_guid: string
          building_name: string | null
          camera_eye: number[] | null
          camera_look: number[] | null
          camera_projection: string | null
          camera_up: number[] | null
          clip_height: number | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          screenshot_url: string | null
          show_annotations: boolean | null
          show_spaces: boolean | null
          updated_at: string | null
          view_mode: string | null
          visible_floor_ids: string[] | null
          visible_model_ids: string[] | null
          visualization_mock_data: boolean | null
          visualization_type: string | null
        }
        Insert: {
          building_fm_guid: string
          building_name?: string | null
          camera_eye?: number[] | null
          camera_look?: number[] | null
          camera_projection?: string | null
          camera_up?: number[] | null
          clip_height?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          screenshot_url?: string | null
          show_annotations?: boolean | null
          show_spaces?: boolean | null
          updated_at?: string | null
          view_mode?: string | null
          visible_floor_ids?: string[] | null
          visible_model_ids?: string[] | null
          visualization_mock_data?: boolean | null
          visualization_type?: string | null
        }
        Update: {
          building_fm_guid?: string
          building_name?: string | null
          camera_eye?: number[] | null
          camera_look?: number[] | null
          camera_projection?: string | null
          camera_up?: number[] | null
          clip_height?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          screenshot_url?: string | null
          show_annotations?: boolean | null
          show_spaces?: boolean | null
          updated_at?: string | null
          view_mode?: string | null
          visible_floor_ids?: string[] | null
          visible_model_ids?: string[] | null
          visualization_mock_data?: boolean | null
          visualization_type?: string | null
        }
        Relationships: []
      }
      scan_jobs: {
        Row: {
          building_fm_guid: string
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          current_dataset: string | null
          current_image_index: number | null
          detections_found: number | null
          error_message: string | null
          id: string
          ivion_site_id: string
          processed_images: number | null
          started_at: string | null
          status: string | null
          templates: string[]
          total_images: number | null
        }
        Insert: {
          building_fm_guid: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          current_dataset?: string | null
          current_image_index?: number | null
          detections_found?: number | null
          error_message?: string | null
          id?: string
          ivion_site_id: string
          processed_images?: number | null
          started_at?: string | null
          status?: string | null
          templates: string[]
          total_images?: number | null
        }
        Update: {
          building_fm_guid?: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          current_dataset?: string | null
          current_image_index?: number | null
          detections_found?: number | null
          error_message?: string | null
          id?: string
          ivion_site_id?: string
          processed_images?: number | null
          started_at?: string | null
          status?: string | null
          templates?: string[]
          total_images?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scan_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      viewer_themes: {
        Row: {
          color_mappings: Json
          created_at: string
          edge_settings: Json | null
          id: string
          is_system: boolean
          name: string
          space_opacity: number | null
          updated_at: string
        }
        Insert: {
          color_mappings?: Json
          created_at?: string
          edge_settings?: Json | null
          id?: string
          is_system?: boolean
          name: string
          space_opacity?: number | null
          updated_at?: string
        }
        Update: {
          color_mappings?: Json
          created_at?: string
          edge_settings?: Json | null
          id?: string
          is_system?: boolean
          name?: string
          space_opacity?: number | null
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
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
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
