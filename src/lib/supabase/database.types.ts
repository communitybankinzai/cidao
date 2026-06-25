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
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          detail: Json | null
          id: string
          ip_hash: string | null
          target_id: string | null
          target_type: string | null
          timestamp: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          detail?: Json | null
          id?: string
          ip_hash?: string | null
          target_id?: string | null
          target_type?: string | null
          timestamp?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["audit_actor_type"]
          detail?: Json | null
          id?: string
          ip_hash?: string | null
          target_id?: string | null
          target_type?: string | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["comment_kind"]
          likes: number
          parent_id: string | null
          proposal_id: string
          recipient_id: string | null
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["comment_kind"]
          likes?: number
          parent_id?: string | null
          proposal_id: string
          recipient_id?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["comment_kind"]
          likes?: number
          parent_id?: string | null
          proposal_id?: string
          recipient_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      contributions: {
        Row: {
          action_type: string
          actor_id: string
          created_at: string
          id: string
          pt: number
          reason: string | null
          related_id: string | null
        }
        Insert: {
          action_type: string
          actor_id: string
          created_at?: string
          id?: string
          pt: number
          reason?: string | null
          related_id?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string
          created_at?: string
          id?: string
          pt?: number
          reason?: string | null
          related_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contributions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_uses: {
        Row: {
          coupon_id: string
          member_id: string
          used_at: string
        }
        Insert: {
          coupon_id: string
          member_id: string
          used_at?: string
        }
        Update: {
          coupon_id?: string
          member_id?: string
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_uses_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_uses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          conditions: string | null
          content: string
          created_at: string
          expires_at: string
          id: string
          post_id: string
          usage_limit: number | null
        }
        Insert: {
          conditions?: string | null
          content: string
          created_at?: string
          expires_at: string
          id?: string
          post_id: string
          usage_limit?: number | null
        }
        Update: {
          conditions?: string | null
          content?: string
          created_at?: string
          expires_at?: string
          id?: string
          post_id?: string
          usage_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "freefree_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      event_participants: {
        Row: {
          attended: boolean | null
          event_id: string
          joined_at: string
          member_id: string
          role: Database["public"]["Enums"]["event_participant_role"]
        }
        Insert: {
          attended?: boolean | null
          event_id: string
          joined_at?: string
          member_id: string
          role?: Database["public"]["Enums"]["event_participant_role"]
        }
        Update: {
          attended?: boolean | null
          event_id?: string
          joined_at?: string
          member_id?: string
          role?: Database["public"]["Enums"]["event_participant_role"]
        }
        Relationships: [
          {
            foreignKeyName: "event_participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_participants_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          capacity: number | null
          category: string
          created_at: string
          description: string
          end_at: string
          fee: number | null
          id: string
          location: string | null
          online_flag: boolean
          organizer_id: string
          organizer_type: Database["public"]["Enums"]["event_organizer_type"]
          proxy_registration: boolean
          proxy_source_url: string | null
          recruitment_type: string[] | null
          start_at: string
          status: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          category: string
          created_at?: string
          description: string
          end_at: string
          fee?: number | null
          id?: string
          location?: string | null
          online_flag?: boolean
          organizer_id: string
          organizer_type: Database["public"]["Enums"]["event_organizer_type"]
          proxy_registration?: boolean
          proxy_source_url?: string | null
          recruitment_type?: string[] | null
          start_at: string
          status?: Database["public"]["Enums"]["event_status"]
          title: string
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          category?: string
          created_at?: string
          description?: string
          end_at?: string
          fee?: number | null
          id?: string
          location?: string | null
          online_flag?: boolean
          organizer_id?: string
          organizer_type?: Database["public"]["Enums"]["event_organizer_type"]
          proxy_registration?: boolean
          proxy_source_url?: string | null
          recruitment_type?: string[] | null
          start_at?: string
          status?: Database["public"]["Enums"]["event_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      faqs: {
        Row: {
          answer: string
          approved_by: string | null
          created_at: string
          id: string
          proposal_id: string
          question: string
          source: Database["public"]["Enums"]["faq_source"]
        }
        Insert: {
          answer: string
          approved_by?: string | null
          created_at?: string
          id?: string
          proposal_id: string
          question: string
          source: Database["public"]["Enums"]["faq_source"]
        }
        Update: {
          answer?: string
          approved_by?: string | null
          created_at?: string
          id?: string
          proposal_id?: string
          question?: string
          source?: Database["public"]["Enums"]["faq_source"]
        }
        Relationships: [
          {
            foreignKeyName: "faqs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faqs_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      freefree_posts: {
        Row: {
          body: string
          category: string
          created_at: string
          expires_at: string | null
          id: string
          images: string[] | null
          location: string | null
          period: Database["public"]["Enums"]["freefree_period"]
          poster_id: string
          poster_type: Database["public"]["Enums"]["freefree_poster_type"]
          status: Database["public"]["Enums"]["freefree_status"]
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          category: string
          created_at?: string
          expires_at?: string | null
          id?: string
          images?: string[] | null
          location?: string | null
          period: Database["public"]["Enums"]["freefree_period"]
          poster_id: string
          poster_type: Database["public"]["Enums"]["freefree_poster_type"]
          status?: Database["public"]["Enums"]["freefree_status"]
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          images?: string[] | null
          location?: string | null
          period?: Database["public"]["Enums"]["freefree_period"]
          poster_id?: string
          poster_type?: Database["public"]["Enums"]["freefree_poster_type"]
          status?: Database["public"]["Enums"]["freefree_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      member_profiles_pr: {
        Row: {
          available_times: string[] | null
          contributions: string | null
          interests_free_text: string | null
          member_id: string
          message_acceptance: Database["public"]["Enums"]["pr_message_acceptance"]
          public_scope: Database["public"]["Enums"]["pr_public_scope"]
          qualifications: string | null
          updated_at: string
        }
        Insert: {
          available_times?: string[] | null
          contributions?: string | null
          interests_free_text?: string | null
          member_id: string
          message_acceptance?: Database["public"]["Enums"]["pr_message_acceptance"]
          public_scope?: Database["public"]["Enums"]["pr_public_scope"]
          qualifications?: string | null
          updated_at?: string
        }
        Update: {
          available_times?: string[] | null
          contributions?: string | null
          interests_free_text?: string | null
          member_id?: string
          message_acceptance?: Database["public"]["Enums"]["pr_message_acceptance"]
          public_scope?: Database["public"]["Enums"]["pr_public_scope"]
          qualifications?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_profiles_pr_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          admin_role: Database["public"]["Enums"]["admin_role"] | null
          auth_provider_id: string
          collaboration_consent: boolean | null
          contact_permission: boolean
          contact_preferences: Json | null
          created_at: string
          deleted_at: string | null
          display_name: string
          id: string
          interests: string[]
          last_active_at: string | null
          preferred_activity_areas: string[] | null
          preferred_activity_forms: string[] | null
          public_settings: Json | null
          ranking_opt_in: boolean
          relation_type: string | null
          residence_verified_at: string | null
          residency_type: Database["public"]["Enums"]["residency_type"]
          self_introduction: string | null
          skills_text: string | null
          subject_id_hash: string | null
          tier: Database["public"]["Enums"]["member_tier"]
          updated_at: string
        }
        Insert: {
          admin_role?: Database["public"]["Enums"]["admin_role"] | null
          auth_provider_id?: string
          collaboration_consent?: boolean | null
          contact_permission?: boolean
          contact_preferences?: Json | null
          created_at?: string
          deleted_at?: string | null
          display_name: string
          id: string
          interests?: string[]
          last_active_at?: string | null
          preferred_activity_areas?: string[] | null
          preferred_activity_forms?: string[] | null
          public_settings?: Json | null
          ranking_opt_in?: boolean
          relation_type?: string | null
          residence_verified_at?: string | null
          residency_type: Database["public"]["Enums"]["residency_type"]
          self_introduction?: string | null
          skills_text?: string | null
          subject_id_hash?: string | null
          tier?: Database["public"]["Enums"]["member_tier"]
          updated_at?: string
        }
        Update: {
          admin_role?: Database["public"]["Enums"]["admin_role"] | null
          auth_provider_id?: string
          collaboration_consent?: boolean | null
          contact_permission?: boolean
          contact_preferences?: Json | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string
          id?: string
          interests?: string[]
          last_active_at?: string | null
          preferred_activity_areas?: string[] | null
          preferred_activity_forms?: string[] | null
          public_settings?: Json | null
          ranking_opt_in?: boolean
          relation_type?: string | null
          residence_verified_at?: string | null
          residency_type?: Database["public"]["Enums"]["residency_type"]
          self_introduction?: string | null
          skills_text?: string | null
          subject_id_hash?: string | null
          tier?: Database["public"]["Enums"]["member_tier"]
          updated_at?: string
        }
        Relationships: []
      }
      memberships: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          display_in_org: boolean
          joined_at: string
          left_at: string | null
          member_id: string
          note: string | null
          org_id: string
          role: Database["public"]["Enums"]["membership_role"]
          role_label: string | null
          status: Database["public"]["Enums"]["membership_status"]
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          display_in_org?: boolean
          joined_at?: string
          left_at?: string | null
          member_id: string
          note?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["membership_role"]
          role_label?: string | null
          status?: Database["public"]["Enums"]["membership_status"]
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          display_in_org?: boolean
          joined_at?: string
          left_at?: string | null
          member_id?: string
          note?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          role_label?: string | null
          status?: Database["public"]["Enums"]["membership_status"]
        }
        Relationships: [
          {
            foreignKeyName: "memberships_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          read_at: string | null
          recipient_id: string
          reply_deadline: string | null
          sender_id: string
          subject: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["message_kind"]
          read_at?: string | null
          recipient_id: string
          reply_deadline?: string | null
          sender_id: string
          subject: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          read_at?: string | null
          recipient_id?: string
          reply_deadline?: string | null
          sender_id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_categories: {
        Row: {
          category: string
          is_primary: boolean
          org_id: string
        }
        Insert: {
          category: string
          is_primary?: boolean
          org_id: string
        }
        Update: {
          category?: string
          is_primary?: boolean
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          accept_messages: boolean
          contact_email: string | null
          contact_url: string | null
          created_at: string
          description: string | null
          founded_at: string | null
          id: string
          inzai_registration_number: string | null
          name: string
          public_flag: boolean
          recruitment_status: Database["public"]["Enums"]["recruitment_status"]
          representative_id: string
          type: Database["public"]["Enums"]["organization_type"]
          updated_at: string
        }
        Insert: {
          accept_messages?: boolean
          contact_email?: string | null
          contact_url?: string | null
          created_at?: string
          description?: string | null
          founded_at?: string | null
          id?: string
          inzai_registration_number?: string | null
          name: string
          public_flag?: boolean
          recruitment_status?: Database["public"]["Enums"]["recruitment_status"]
          representative_id: string
          type: Database["public"]["Enums"]["organization_type"]
          updated_at?: string
        }
        Update: {
          accept_messages?: boolean
          contact_email?: string | null
          contact_url?: string | null
          created_at?: string
          description?: string | null
          founded_at?: string | null
          id?: string
          inzai_registration_number?: string | null
          name?: string
          public_flag?: boolean
          recruitment_status?: Database["public"]["Enums"]["recruitment_status"]
          representative_id?: string
          type?: Database["public"]["Enums"]["organization_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          binding_type: Database["public"]["Enums"]["binding_type"]
          body: string
          budget_size: Database["public"]["Enums"]["budget_size"]
          category: string
          created_at: string
          discussion_start_at: string | null
          draft_saved_at: string | null
          id: string
          implementation_date: string
          proposer_id: string
          related_links: string[] | null
          status: Database["public"]["Enums"]["proposal_status"]
          title: string
          updated_at: string
          voting_end_at: string | null
          voting_start_at: string | null
        }
        Insert: {
          binding_type: Database["public"]["Enums"]["binding_type"]
          body: string
          budget_size: Database["public"]["Enums"]["budget_size"]
          category: string
          created_at?: string
          discussion_start_at?: string | null
          draft_saved_at?: string | null
          id?: string
          implementation_date: string
          proposer_id: string
          related_links?: string[] | null
          status?: Database["public"]["Enums"]["proposal_status"]
          title: string
          updated_at?: string
          voting_end_at?: string | null
          voting_start_at?: string | null
        }
        Update: {
          binding_type?: Database["public"]["Enums"]["binding_type"]
          body?: string
          budget_size?: Database["public"]["Enums"]["budget_size"]
          category?: string
          created_at?: string
          discussion_start_at?: string | null
          draft_saved_at?: string | null
          id?: string
          implementation_date?: string
          proposer_id?: string
          related_links?: string[] | null
          status?: Database["public"]["Enums"]["proposal_status"]
          title?: string
          updated_at?: string
          voting_end_at?: string | null
          voting_start_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_proposer_id_fkey"
            columns: ["proposer_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      sns_post_logs: {
        Row: {
          created_at: string
          engagements: number | null
          error_message: string | null
          id: string
          impressions: number | null
          medium: Database["public"]["Enums"]["sns_medium"]
          posted_at: string | null
          posted_id: string | null
          status: Database["public"]["Enums"]["sns_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["sns_target_type"]
        }
        Insert: {
          created_at?: string
          engagements?: number | null
          error_message?: string | null
          id?: string
          impressions?: number | null
          medium: Database["public"]["Enums"]["sns_medium"]
          posted_at?: string | null
          posted_id?: string | null
          status?: Database["public"]["Enums"]["sns_status"]
          target_id: string
          target_type: Database["public"]["Enums"]["sns_target_type"]
        }
        Update: {
          created_at?: string
          engagements?: number | null
          error_message?: string | null
          id?: string
          impressions?: number | null
          medium?: Database["public"]["Enums"]["sns_medium"]
          posted_at?: string | null
          posted_id?: string | null
          status?: Database["public"]["Enums"]["sns_status"]
          target_id?: string
          target_type?: Database["public"]["Enums"]["sns_target_type"]
        }
        Relationships: []
      }
      sns_rotation: {
        Row: {
          category: string | null
          last_spotlighted_at: string | null
          target_id: string
          target_type: Database["public"]["Enums"]["sns_target_type"]
        }
        Insert: {
          category?: string | null
          last_spotlighted_at?: string | null
          target_id: string
          target_type: Database["public"]["Enums"]["sns_target_type"]
        }
        Update: {
          category?: string | null
          last_spotlighted_at?: string | null
          target_id?: string
          target_type?: Database["public"]["Enums"]["sns_target_type"]
        }
        Relationships: []
      }
      supports: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["support_kind"]
          member_id: string
          post_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["support_kind"]
          member_id: string
          post_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["support_kind"]
          member_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supports_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "freefree_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      vote_aggregates: {
        Row: {
          choice: string
          count: number
          proposal_id: string
          tier: Database["public"]["Enums"]["member_tier"]
          updated_at: string
          weight_total: number
        }
        Insert: {
          choice: string
          count?: number
          proposal_id: string
          tier: Database["public"]["Enums"]["member_tier"]
          updated_at?: string
          weight_total?: number
        }
        Update: {
          choice?: string
          count?: number
          proposal_id?: string
          tier?: Database["public"]["Enums"]["member_tier"]
          updated_at?: string
          weight_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "vote_aggregates_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      votes: {
        Row: {
          cast_at: string
          choice: string
          id: string
          proposal_id: string
          retracted_at: string | null
          voter_id: string
          weight: number
        }
        Insert: {
          cast_at?: string
          choice: string
          id?: string
          proposal_id: string
          retracted_at?: string | null
          voter_id: string
          weight: number
        }
        Update: {
          cast_at?: string
          choice?: string
          id?: string
          proposal_id?: string
          retracted_at?: string | null
          voter_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "votes_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      award_contribution: {
        Args: {
          p_action: string
          p_actor: string
          p_pt: number
          p_reason?: string
          p_related: string
        }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_committee_or_super: { Args: never; Returns: boolean }
      is_org_officer: { Args: { org: string }; Returns: boolean }
      is_org_representative: { Args: { org: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      admin_role: "staff" | "committee" | "super"
      audit_actor_type: "member" | "admin" | "system"
      binding_type: "internal" | "hosted" | "external"
      budget_size: "small" | "medium" | "large"
      comment_kind: "question" | "answer" | "comment"
      event_organizer_type: "org" | "member"
      event_participant_role: "participant" | "staff" | "organizer"
      event_status: "draft" | "open" | "closed" | "cancelled"
      faq_source: "ai" | "manual"
      freefree_period: "p_1week" | "p_1month" | "p_3months"
      freefree_poster_type: "member" | "org" | "individual_business"
      freefree_status: "pending" | "active" | "expired" | "removed"
      member_tier: "light" | "email_only" | "verified"
      membership_role: "representative" | "officer" | "member"
      membership_status: "claimed" | "confirmed"
      message_kind: "request" | "consult" | "thanks" | "outreach"
      organization_type: "voluntary" | "civic" | "company" | "government"
      pr_message_acceptance: "open" | "recommended_only" | "closed"
      pr_public_scope: "public" | "registered_only" | "consent_only"
      proposal_status:
        | "draft"
        | "discussion"
        | "voting"
        | "closed"
        | "passed"
        | "rejected"
      recruitment_status: "open" | "closed" | "invitation_only" | "unknown"
      residency_type: "citizen" | "related_population"
      sns_medium: "x" | "facebook" | "line"
      sns_status: "success" | "failed" | "pending"
      sns_target_type: "event" | "org" | "freefree"
      support_kind: "like" | "comment"
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
      admin_role: ["staff", "committee", "super"],
      audit_actor_type: ["member", "admin", "system"],
      binding_type: ["internal", "hosted", "external"],
      budget_size: ["small", "medium", "large"],
      comment_kind: ["question", "answer", "comment"],
      event_organizer_type: ["org", "member"],
      event_participant_role: ["participant", "staff", "organizer"],
      event_status: ["draft", "open", "closed", "cancelled"],
      faq_source: ["ai", "manual"],
      freefree_period: ["p_1week", "p_1month", "p_3months"],
      freefree_poster_type: ["member", "org", "individual_business"],
      freefree_status: ["pending", "active", "expired", "removed"],
      member_tier: ["light", "email_only", "verified"],
      membership_role: ["representative", "officer", "member"],
      membership_status: ["claimed", "confirmed"],
      message_kind: ["request", "consult", "thanks", "outreach"],
      organization_type: ["voluntary", "civic", "company", "government"],
      pr_message_acceptance: ["open", "recommended_only", "closed"],
      pr_public_scope: ["public", "registered_only", "consent_only"],
      proposal_status: [
        "draft",
        "discussion",
        "voting",
        "closed",
        "passed",
        "rejected",
      ],
      recruitment_status: ["open", "closed", "invitation_only", "unknown"],
      residency_type: ["citizen", "related_population"],
      sns_medium: ["x", "facebook", "line"],
      sns_status: ["success", "failed", "pending"],
      sns_target_type: ["event", "org", "freefree"],
      support_kind: ["like", "comment"],
    },
  },
} as const
