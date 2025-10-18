

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."IntoFashion" AS ENUM (
    'New_To_Fashion',
    'Finding_My_Style',
    'Know_My_Style'
);


ALTER TYPE "public"."IntoFashion" OWNER TO "postgres";


CREATE TYPE "public"."bottoms_size" AS ENUM (
    'TWENTY_EIGHT',
    'THIRTY'
);


ALTER TYPE "public"."bottoms_size" OWNER TO "postgres";


CREATE TYPE "public"."bust_size" AS ENUM (
    'THIRTY_TWO',
    'THIRTY_FOUR'
);


ALTER TYPE "public"."bust_size" OWNER TO "postgres";


CREATE TYPE "public"."cart_status" AS ENUM (
    'UNCONFIRMED',
    'CONFIRMED'
);


ALTER TYPE "public"."cart_status" OWNER TO "postgres";


CREATE TYPE "public"."device_platform" AS ENUM (
    'IOS',
    'ANDROID',
    'WEB'
);


ALTER TYPE "public"."device_platform" OWNER TO "postgres";


CREATE TYPE "public"."discovery_methods" AS ENUM (
    'APP_STORE',
    'FRIENDS',
    'INSTAGRAM',
    'WEB_SEARCH',
    'OTHER',
    'TWITTER'
);


ALTER TYPE "public"."discovery_methods" OWNER TO "postgres";


CREATE TYPE "public"."dress_size" AS ENUM (
    'ZERO',
    'ONE'
);


ALTER TYPE "public"."dress_size" OWNER TO "postgres";


CREATE TYPE "public"."ecommerce_software" AS ENUM (
    'SHOPIFY',
    'SITEMAP'
);


ALTER TYPE "public"."ecommerce_software" OWNER TO "postgres";


COMMENT ON TYPE "public"."ecommerce_software" IS 'The provider for ecommerce software';



CREATE TYPE "public"."explore_request_type" AS ENUM (
    'outfit_request',
    'item_request'
);


ALTER TYPE "public"."explore_request_type" OWNER TO "postgres";


CREATE TYPE "public"."fetch_frequency" AS ENUM (
    '2 Weeks',
    '3 Weeks',
    'Monthly',
    'Seasonally'
);


ALTER TYPE "public"."fetch_frequency" OWNER TO "postgres";


CREATE TYPE "public"."fit" AS ENUM (
    'SLIM',
    'REGULAR',
    'LOOSE',
    'RELAXED',
    'OVERSIZED',
    'ATHLETIC',
    'TAILORED',
    'BAGGY',
    'CROPPED'
);


ALTER TYPE "public"."fit" OWNER TO "postgres";


COMMENT ON TYPE "public"."fit" IS 'the fit of the products';



CREATE TYPE "public"."gender" AS ENUM (
    'FEMALE',
    'MALE',
    'UNSPECIFIED',
    'UNISEX'
);


ALTER TYPE "public"."gender" OWNER TO "postgres";


CREATE TYPE "public"."not_selected_reason" AS ENUM (
    'STYLE',
    'COLOR',
    'BRAND',
    'EXPENSIVE',
    'OTHER'
);


ALTER TYPE "public"."not_selected_reason" OWNER TO "postgres";


CREATE TYPE "public"."order_lifecycle_status" AS ENUM (
    'initiated',
    'waiting_for_stylist',
    'waiting_for_user_feedback',
    'to_be_purchased',
    'purchased',
    'shipping_in_transit',
    'delivered',
    'cancelled',
    'refunded'
);


ALTER TYPE "public"."order_lifecycle_status" OWNER TO "postgres";


CREATE TYPE "public"."order_status" AS ENUM (
    'PENDING',
    'PROCESSING',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
    'RETURNED',
    'CONFIRMED'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE TYPE "public"."order_suggestion_status" AS ENUM (
    'Pending',
    'Reviewed',
    'Archived'
);


ALTER TYPE "public"."order_suggestion_status" OWNER TO "postgres";


CREATE TYPE "public"."product_category" AS ENUM (
    'TOPS',
    'BOTTOMS',
    'OTHER',
    'DRESSES',
    'UNDERWEAR',
    'ACCESSORIES',
    'SHOES'
);


ALTER TYPE "public"."product_category" OWNER TO "postgres";


COMMENT ON TYPE "public"."product_category" IS 'for search filtering purposes';



CREATE TYPE "public"."product_purchase_feedback_category" AS ENUM (
    'fit_sizing',
    'style_color',
    'quality_issue',
    'damaged_defective',
    'no_longer_needed',
    'other',
    'good_fit',
    'good_color',
    'high_quality_fabric',
    'good_value',
    'matches_wardrobe',
    'like_brand',
    'good_other'
);


ALTER TYPE "public"."product_purchase_feedback_category" OWNER TO "postgres";


CREATE TYPE "public"."product_purchase_suggestion_status" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED'
);


ALTER TYPE "public"."product_purchase_suggestion_status" OWNER TO "postgres";


CREATE TYPE "public"."refund_status" AS ENUM (
    'pending_user_feedback',
    'deadline_expired',
    'requested',
    'requested_item_picked_up',
    'requested_shipped_back',
    'requested_non_refundable_item'
);


ALTER TYPE "public"."refund_status" OWNER TO "postgres";


CREATE TYPE "public"."request_phase" AS ENUM (
    'EXPLORATION',
    'REFINEMENT',
    'ORDER'
);


ALTER TYPE "public"."request_phase" OWNER TO "postgres";


CREATE TYPE "public"."request_status" AS ENUM (
    'PROCESSING',
    'READY',
    'CONFIRMED',
    'CANCELLED',
    'ARCHIVED'
);


ALTER TYPE "public"."request_status" OWNER TO "postgres";


CREATE TYPE "public"."request_suggestion_preference" AS ENUM (
    'NEUTRAL',
    'LIKE',
    'SUPERLIKE'
);


ALTER TYPE "public"."request_suggestion_preference" OWNER TO "postgres";


CREATE TYPE "public"."shipment_status" AS ENUM (
    'Pending_Shipping',
    'Shipping',
    'Delivered'
);


ALTER TYPE "public"."shipment_status" OWNER TO "postgres";


CREATE TYPE "public"."shoes_size" AS ENUM (
    'FIVE',
    'SIX'
);


ALTER TYPE "public"."shoes_size" OWNER TO "postgres";


CREATE TYPE "public"."style_swipe" AS ENUM (
    'LIKE',
    'DISLIKE',
    'NEUTRAL',
    'SUPERLIKE',
    'MAYBE'
);


ALTER TYPE "public"."style_swipe" OWNER TO "postgres";


CREATE TYPE "public"."tops_size" AS ENUM (
    'XS',
    'S',
    'M',
    'L',
    'XL',
    'XXL'
);


ALTER TYPE "public"."tops_size" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'CUSTOMER',
    'STYLIST',
    'ADMIN'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE TYPE "public"."waist_size" AS ENUM (
    'TWENTY_EIGHT',
    'THIRTY'
);


ALTER TYPE "public"."waist_size" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_update_cart_items"("items_array" "jsonb") RETURNS TABLE("updated_id" "uuid", "success" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$DECLARE
    item jsonb;
    result record;
BEGIN
    FOR item IN SELECT * FROM jsonb_array_elements(items_array)
    LOOP
        UPDATE "public"."cart_items"
        SET 
        selected = COALESCE((item->>'selected')::boolean, selected),
        not_selected_reasons = COALESCE(
          (SELECT array_agg(value::text) FROM jsonb_array_elements_text(item->'not_selected_reasons') AS value)::text[], 
          not_selected_reasons
        )
      WHERE id = (item->>'id')::uuid
RETURNING id INTO result;

IF FOUND THEN
    updated_id := result.id;
    success := true;
ELSE
    updated_id := (item->>'id')::uuid;
    success := false;
END IF;

RETURN NEXT;
END LOOP;
END;$$;


ALTER FUNCTION "public"."bulk_update_cart_items"("items_array" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_recent_runs"("p_limit" integer) RETURNS TABLE("pipeline_run_id" "text", "brand_id" "uuid", "created_at" timestamp with time zone, "product_count" bigint, "brand_name" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    WITH run_stats AS (
        SELECT 
            p.pipeline_run_id,
            p.brand_id,
            MIN(p.created_at) as created_at,
            COUNT(*) as product_count
        FROM products_clean p
        WHERE p.pipeline_run_id IS NOT NULL
        GROUP BY p.pipeline_run_id, p.brand_id
    )
    SELECT 
        rs.pipeline_run_id,
        rs.brand_id,
        rs.created_at,
        rs.product_count,
        b.company as brand_name
    FROM run_stats rs
    LEFT JOIN brands b ON b.id = rs.brand_id
    ORDER BY rs.created_at DESC
    LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."get_recent_runs"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user"("user_id" "uuid") RETURNS TABLE("id" "uuid", "email" character varying, "first_name" "text", "last_name" "text", "gender" "public"."gender", "address_line_one" "text", "address_line_two" "text", "address_city" "text", "address_state" "text", "address_country" "text", "address_postal_code" "text", "transcript" "text")
    LANGUAGE "plpgsql"
    AS $$BEGIN
  RETURN QUERY
  SELECT  
    pu.id,
    au.email,
    pu.first_name,
    pu.last_name,
    pu.gender,
    pu.address_line_one,
    pu.address_line_two,
    pu.address_city,
    pu.address_state,
    pu.address_country,
    pu.address_postal_code,
    pu.transcript
  FROM
    public.users AS pu
    JOIN auth.users AS au ON pu.id = au.id
  WHERE
    pu.id = user_id;
END;$$;


ALTER FUNCTION "public"."get_user"("user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user"("user_id" "uuid", "cachebuster" "text") RETURNS TABLE("id" "uuid", "email" character varying, "first_name" "text", "last_name" "text", "gender" "public"."gender", "address_line_one" "text", "address_line_two" "text", "address_city" "text", "address_state" "text", "address_country" "text", "address_postal_code" "text", "transcript" "text", "style_profile" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT  
    pu.id,
    au.email,
    pu.first_name,
    pu.last_name,
    pu.gender,
    pu.address_line_one,
    pu.address_line_two,
    pu.address_city,
    pu.address_state,
    pu.address_country,
    pu.address_postal_code,
    pu.transcript,
    pu.style_profile
  FROM
    public.users AS pu
    JOIN auth.users AS au ON pu.id = au.id
  WHERE
    pu.id = user_id;
END;
$$;


ALTER FUNCTION "public"."get_user"("user_id" "uuid", "cachebuster" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$BEGIN
  INSERT INTO public.users (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE 
      WHEN NEW.raw_user_meta_data->>'role' IS NOT NULL 
      THEN (
        CASE (NEW.raw_user_meta_data->>'role')::int
          WHEN 2 THEN 'ADMIN'::user_role
          WHEN 1 THEN 'STYLIST'::user_role
          ELSE 'CUSTOMER'::user_role
        END
      )
      ELSE 'CUSTOMER'::user_role
    END
  );

  INSERT INTO public.subscriptions (user_id, email)
  VALUES (NEW.id, NEW.email);

  RETURN NEW;
END;$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_users"() RETURNS TABLE("id" "uuid", "email" character varying, "first_name" "text", "last_name" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT  
    pu.id,
    au.email,
    pu.first_name,
    pu.last_name
  FROM
    public.users AS pu
    JOIN auth.users AS au ON pu.id = au.id;
END;
$$;


ALTER FUNCTION "public"."list_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_users"("cachebuster" "text") RETURNS TABLE("id" "uuid", "email" character varying, "first_name" "text", "last_name" "text")
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT  
    pu.id,
    au.email,
    pu.first_name,
    pu.last_name
  FROM
    public.users AS pu
    JOIN auth.users AS au ON pu.id = au.id;
END;
$$;


ALTER FUNCTION "public"."list_users"("cachebuster" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profile_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  -- Update the email in public.profiles using the ID from auth.users
  UPDATE public.users
  SET email = (SELECT email FROM auth.users WHERE id = NEW.id)
  WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_profile_email"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."brands" (
    "company" "text" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gpt_summary" "text",
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ecommerce_software" "public"."ecommerce_software",
    "gender" "public"."gender"
);


ALTER TABLE "public"."brands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."carts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_ids" "uuid"[],
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."carts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_type" "text",
    "messages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chats_backup" (
    "id" "uuid",
    "agent_type" "text",
    "messages" "jsonb",
    "metadata" "jsonb",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."chats_backup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chats_dev" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_type" "text",
    "messages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chats_dev" OWNER TO "postgres";


COMMENT ON TABLE "public"."chats_dev" IS 'Chats for dev app';



CREATE TABLE IF NOT EXISTS "public"."explore_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "original_user_query" "text",
    "generated_title" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_suggestions" "jsonb",
    "status" "public"."request_status" DEFAULT 'PROCESSING'::"public"."request_status" NOT NULL,
    "query" "text",
    "order_scheduled_for" "text",
    "lower_budget" "text",
    "upper_budget" "text",
    "phase" "public"."request_phase",
    "brand_ids" "uuid"[],
    "category" "public"."product_category",
    "gender" "public"."gender" DEFAULT 'MALE'::"public"."gender" NOT NULL,
    "dev_is_deleted" boolean DEFAULT false NOT NULL,
    "dev_is_dev_only" boolean DEFAULT false NOT NULL,
    "messages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "image_urls" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "version" integer DEFAULT 0 NOT NULL,
    "request_type" "public"."explore_request_type"
);


ALTER TABLE "public"."explore_requests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."explore_requests"."query" IS 'what is sent to our vector db';



COMMENT ON COLUMN "public"."explore_requests"."phase" IS 'black circle or blue circle';



COMMENT ON COLUMN "public"."explore_requests"."messages" IS 'A json of the messages object for this request';



CREATE TABLE IF NOT EXISTS "public"."external_images" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "external_image_url" "text" NOT NULL,
    "internal_image_url" "text" NOT NULL
);


ALTER TABLE "public"."external_images" OWNER TO "postgres";


ALTER TABLE "public"."external_images" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."external_images_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."external_product_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "external_url" "text" NOT NULL,
    "internal_url" "text",
    "style" "text",
    "embeddings" "json",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."external_product_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."image_preferences" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "image_url" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "explore_request_id" "uuid",
    "preference_type" "public"."style_swipe",
    "comments" "text"
);


ALTER TABLE "public"."image_preferences" OWNER TO "postgres";


ALTER TABLE "public"."image_preferences" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."image_preferences_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."order_cart_product" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_cart_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "chosen_size" "text",
    "current_price" real NOT NULL,
    "original_price" real,
    "chosen_color" "text"
);


ALTER TABLE "public"."order_cart_product" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_carts" (
    "product_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "order_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "public"."order_carts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_suggestion" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."order_suggestion_status" DEFAULT 'Pending'::"public"."order_suggestion_status" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "verify_suggestions_by" timestamp with time zone DEFAULT ("now"() + '1 day'::interval) NOT NULL,
    "verify_purchase_by" timestamp with time zone,
    "pre_archive_status" "public"."order_suggestion_status"
);


ALTER TABLE "public"."order_suggestion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders_v2" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "stylist_id" "uuid",
    "chat_id" "uuid",
    "status" "public"."order_lifecycle_status" DEFAULT 'initiated'::"public"."order_lifecycle_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_view_version" integer DEFAULT 1 NOT NULL,
    "is_starred" boolean DEFAULT false NOT NULL,
    "note" "text",
    "product_recommendations" "jsonb",
    CONSTRAINT "orders_v2_version_check" CHECK (("user_view_version" > 0))
);


ALTER TABLE "public"."orders_v2" OWNER TO "postgres";


COMMENT ON TABLE "public"."orders_v2" IS 'Stores order information with lifecycle status tracking';



CREATE TABLE IF NOT EXISTS "public"."pending_register_user_info" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text" NOT NULL,
    "generated_bio" "text" NOT NULL,
    "first_chat_query" "text",
    "transcript" "text" NOT NULL
);


ALTER TABLE "public"."pending_register_user_info" OWNER TO "postgres";


ALTER TABLE "public"."pending_register_user_info" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."pending_register_user_info_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."product_preferences" (
    "product_id" "uuid" NOT NULL,
    "preference_type" "public"."style_swipe",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comments" "text",
    "request_id" "uuid" NOT NULL,
    "query" "text",
    "cohort" bigint DEFAULT '1'::bigint NOT NULL
);


ALTER TABLE "public"."product_preferences" OWNER TO "postgres";


COMMENT ON TABLE "public"."product_preferences" IS 'left / right swipes';



COMMENT ON COLUMN "public"."product_preferences"."cohort" IS 'The cohort this preferences was shown for this request';



CREATE TABLE IF NOT EXISTS "public"."product_purchase" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "purchased_at" timestamp without time zone NOT NULL,
    "product_id" "uuid" NOT NULL,
    "size" "text" NOT NULL,
    "price" integer NOT NULL,
    "original_price" integer NOT NULL,
    "is_refundable" boolean NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shipment_id" "uuid" NOT NULL,
    "user_feedback_categories" "public"."product_purchase_feedback_category"[],
    "user_feedback_note" "text",
    "refund_status" "public"."refund_status" DEFAULT 'pending_user_feedback'::"public"."refund_status" NOT NULL,
    "color" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."product_purchase" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_purchase_suggestion" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "size" "text" NOT NULL,
    "price" integer NOT NULL,
    "original_price" integer NOT NULL,
    "is_refundable" boolean NOT NULL,
    "is_accepted" boolean DEFAULT false NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_suggestion_id" "uuid" NOT NULL,
    "note" "text",
    "color" "text" NOT NULL,
    "status" "public"."product_purchase_suggestion_status" DEFAULT 'PENDING'::"public"."product_purchase_suggestion_status" NOT NULL
);


ALTER TABLE "public"."product_purchase_suggestion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "title" "text" NOT NULL,
    "price" numeric NOT NULL,
    "url" "text" NOT NULL,
    "gender" "public"."gender",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "category" "public"."product_category",
    "generated_description" "text",
    "image_urls" "text"[],
    "sizes" "text"[],
    "s3_image_urls" "text"[],
    "colors" "text"[],
    "materials" "text"[],
    "details" "text",
    "style" "text",
    "fit" "public"."fit",
    "compressed_jpg_urls" "text"[]
);


ALTER TABLE "public"."products" OWNER TO "postgres";


COMMENT ON TABLE "public"."products" IS 'This is a duplicate of products';



COMMENT ON COLUMN "public"."products"."price" IS 'USD';



COMMENT ON COLUMN "public"."products"."description" IS 'pulled from website';



COMMENT ON COLUMN "public"."products"."generated_description" IS 'generated using image model (and raw description if available)';



COMMENT ON COLUMN "public"."products"."image_urls" IS 'list of the product pictures';



COMMENT ON COLUMN "public"."products"."sizes" IS 'available sizes for clothing';



COMMENT ON COLUMN "public"."products"."s3_image_urls" IS 'permanent image repository';



CREATE TABLE IF NOT EXISTS "public"."products_clean" (
    "title" "text" NOT NULL,
    "price" numeric NOT NULL,
    "url" "text" NOT NULL,
    "gender" "public"."gender",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "category" "public"."product_category",
    "generated_description" "text" NOT NULL,
    "image_urls" "text"[],
    "sizes" "text"[],
    "s3_image_urls" "text"[] NOT NULL,
    "colors" "text"[] NOT NULL,
    "materials" "text"[],
    "details" "text" NOT NULL,
    "style" "text" NOT NULL,
    "fit" "public"."fit",
    "compressed_jpg_urls" "text"[] NOT NULL,
    "sub_brand_id" "uuid",
    "structured_sizes" "jsonb",
    "is_for_kids" boolean,
    "content_quality_check" boolean,
    "manually_added" boolean DEFAULT false,
    "highres_webp_urls" "text"[],
    "pipeline_run_id" "text",
    "sale_price" numeric
);


ALTER TABLE "public"."products_clean" OWNER TO "postgres";


COMMENT ON COLUMN "public"."products_clean"."price" IS 'USD';



COMMENT ON COLUMN "public"."products_clean"."description" IS 'pulled from website';



COMMENT ON COLUMN "public"."products_clean"."generated_description" IS 'generated using image model (and raw description if available)';



COMMENT ON COLUMN "public"."products_clean"."image_urls" IS 'list of the product pictures';



COMMENT ON COLUMN "public"."products_clean"."sizes" IS 'available sizes for clothing';



COMMENT ON COLUMN "public"."products_clean"."s3_image_urls" IS 'permanent image repository';



COMMENT ON COLUMN "public"."products_clean"."structured_sizes" IS 'Stores any dimensional formats for product sizing (for complex products like jeans and bras)';



COMMENT ON COLUMN "public"."products_clean"."is_for_kids" IS 'who is this product for';



COMMENT ON COLUMN "public"."products_clean"."content_quality_check" IS 'title and description make sense';



CREATE TABLE IF NOT EXISTS "public"."products_clean_archive" (
    "title" "text" NOT NULL,
    "price" numeric NOT NULL,
    "url" "text" NOT NULL,
    "gender" "public"."gender",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "category" "public"."product_category",
    "generated_description" "text",
    "image_urls" "text"[],
    "sizes" "text"[],
    "s3_image_urls" "text"[],
    "colors" "text"[],
    "materials" "text"[],
    "details" "text",
    "style" "text",
    "fit" "public"."fit",
    "compressed_jpg_urls" "text"[],
    "sub_brand_id" "uuid",
    "content_quality_check" boolean,
    "is_for_kids" boolean,
    "structured_sizes" "jsonb",
    "highres_webp_urls" "text"[],
    "manually_added" boolean,
    "pipeline_run_id" "text",
    "sale_price" numeric
);


ALTER TABLE "public"."products_clean_archive" OWNER TO "postgres";


COMMENT ON TABLE "public"."products_clean_archive" IS 'Products that for some reason we shouldn''t show to users anymore';



COMMENT ON COLUMN "public"."products_clean_archive"."price" IS 'USD';



COMMENT ON COLUMN "public"."products_clean_archive"."description" IS 'pulled from website';



COMMENT ON COLUMN "public"."products_clean_archive"."generated_description" IS 'generated using image model (and raw description if available)';



COMMENT ON COLUMN "public"."products_clean_archive"."image_urls" IS 'list of the product pictures';



COMMENT ON COLUMN "public"."products_clean_archive"."sizes" IS 'available sizes for clothing';



COMMENT ON COLUMN "public"."products_clean_archive"."s3_image_urls" IS 'permanent image repository';



CREATE TABLE IF NOT EXISTS "public"."sent_notifications" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reference_name" "text" NOT NULL
);


ALTER TABLE "public"."sent_notifications" OWNER TO "postgres";


ALTER TABLE "public"."sent_notifications" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sent_notifications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."shipment" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tracking_url" "text",
    "tracking_number" "text",
    "expected_delivery_date_start" "date",
    "expected_delivery_date_end" "date",
    "brand_id" "uuid" NOT NULL,
    "status" "public"."shipment_status" DEFAULT 'Pending_Shipping'::"public"."shipment_status" NOT NULL,
    "brand_order_number" "text",
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_suggestion_id" "uuid" NOT NULL,
    "delivered_at" timestamp with time zone
);


ALTER TABLE "public"."shipment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signup" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "full_name" "text",
    "email" "text",
    "phone_number" "text",
    "city_country" "text",
    "care_about_clothes" "text"
);


ALTER TABLE "public"."signup" OWNER TO "postgres";


ALTER TABLE "public"."signup" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."signup_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sub_brands" (
    "company" "text" NOT NULL,
    "url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gender" "public"."gender",
    "brand_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL
);


ALTER TABLE "public"."sub_brands" OWNER TO "postgres";


COMMENT ON TABLE "public"."sub_brands" IS 'For brands that carry multiple brands';



CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "email" "text",
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_customer_id_live" "text",
    "stripe_subscription_id" "text",
    "subscription_status" "text" DEFAULT 'none'::"text",
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false,
    "payment_method_brand" "text",
    "payment_method_last4" "text",
    "price_id" "text",
    "stripe_customer_id_test" "text",
    CONSTRAINT "valid_subscription_status" CHECK (("subscription_status" = ANY (ARRAY['none'::"text", 'incomplete'::"text", 'incomplete_expired'::"text", 'trialing'::"text", 'active'::"text", 'past_due'::"text", 'canceled'::"text", 'unpaid'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."temp_users" (
    "address_state" "text",
    "gender" "public"."gender",
    "address_line_one" "text",
    "address_line_two" "text",
    "address_city" "text",
    "first_name" "text",
    "address_country" "text",
    "last_name" "text",
    "address_postal_code" "text",
    "created_at" timestamp with time zone,
    "id" "uuid",
    "expo_push_notification_token" "text",
    "age" smallint,
    "height" smallint,
    "weight" smallint,
    "email" "text",
    "onboarding_completed" boolean,
    "brands_selected" "text"[]
);


ALTER TABLE "public"."temp_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_devices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "device_token" "text" NOT NULL,
    "platform" "public"."device_platform" DEFAULT 'IOS'::"public"."device_platform" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_devices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_sizes" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "preferred_size_tops" "public"."tops_size",
    "preferred_size_dress" "text",
    "preferred_size_shoes" "text",
    "preferred_size_bottoms" "text",
    "preferred_size_bust" "text",
    "preferred_size_waist" "text",
    "preferred_size_hips" "text",
    "preferred_size_inseam" "text",
    "preferred_size_waist_approximate" boolean,
    "preferred_size_hips_approximate" boolean,
    "preferred_size_bust_approximate" boolean,
    "preferred_size_inseam_approximate" boolean
);


ALTER TABLE "public"."user_sizes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "address_state" "text",
    "gender" "public"."gender",
    "address_line_one" "text",
    "address_line_two" "text",
    "address_city" "text",
    "first_name" "text",
    "address_country" "text",
    "last_name" "text",
    "address_postal_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" NOT NULL,
    "expo_push_notification_token" "text",
    "age" smallint,
    "height" smallint,
    "weight" smallint,
    "email" "text",
    "onboarding_completed" boolean DEFAULT false NOT NULL,
    "brands_selected" "text"[],
    "role" "public"."user_role" DEFAULT 'CUSTOMER'::"public"."user_role" NOT NULL,
    "discovery_method" "public"."discovery_methods",
    "instagram_handle" "text",
    "style_image_urls" "text"[],
    "generated_profile_description" "text",
    "generated_profile_description_hash" "text",
    "generated_description_updated_at_num_preferences" bigint,
    "how_into_fashion" "public"."IntoFashion",
    "tried_to_populate_generated_bio_from_pending_register_table" boolean,
    "chosen_first_order_query" "text"
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."carts"
    ADD CONSTRAINT "cart_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."carts"
    ADD CONSTRAINT "cart_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."chats_dev"
    ADD CONSTRAINT "chats_dev_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chats"
    ADD CONSTRAINT "chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."external_images"
    ADD CONSTRAINT "external_images_external_image_url_key" UNIQUE ("external_image_url");



ALTER TABLE ONLY "public"."external_images"
    ADD CONSTRAINT "external_images_pkey" PRIMARY KEY ("id", "external_image_url");



ALTER TABLE ONLY "public"."external_product_images"
    ADD CONSTRAINT "external_product_images_pkey" PRIMARY KEY ("id", "external_url");



ALTER TABLE ONLY "public"."image_preferences"
    ADD CONSTRAINT "image_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_cart_product"
    ADD CONSTRAINT "order_cart_product_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_carts"
    ADD CONSTRAINT "order_carts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_suggestion"
    ADD CONSTRAINT "order_suggestion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders_v2"
    ADD CONSTRAINT "orders_v2_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_register_user_info"
    ADD CONSTRAINT "pending_register_user_info_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."pending_register_user_info"
    ADD CONSTRAINT "pending_register_user_info_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."external_product_images"
    ADD CONSTRAINT "product_images_external_url_key" UNIQUE ("external_url");



ALTER TABLE ONLY "public"."product_preferences"
    ADD CONSTRAINT "product_preferences_duplicate_id_key" UNIQUE ("id");



ALTER TABLE ONLY "public"."product_preferences"
    ADD CONSTRAINT "product_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_purchase"
    ADD CONSTRAINT "product_purchase_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_purchase_suggestion"
    ADD CONSTRAINT "product_purchase_suggestion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products_clean_archive"
    ADD CONSTRAINT "products_clean_archive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products_clean_archive"
    ADD CONSTRAINT "products_clean_archive_url_key" UNIQUE ("url");



ALTER TABLE ONLY "public"."products_clean"
    ADD CONSTRAINT "products_clean_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products_clean"
    ADD CONSTRAINT "products_clean_url_key" UNIQUE ("url");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_old_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_old_url_key" UNIQUE ("url");



ALTER TABLE ONLY "public"."explore_requests"
    ADD CONSTRAINT "requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sent_notifications"
    ADD CONSTRAINT "sent_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sent_notifications"
    ADD CONSTRAINT "sent_notifications_reference_name_key" UNIQUE ("reference_name");



ALTER TABLE ONLY "public"."shipment"
    ADD CONSTRAINT "shipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signup"
    ADD CONSTRAINT "signup_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sub_brands"
    ADD CONSTRAINT "sub_brands_id_key" UNIQUE ("id");



ALTER TABLE ONLY "public"."sub_brands"
    ADD CONSTRAINT "sub_brands_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_devices"
    ADD CONSTRAINT "user_devices_device_token_key" UNIQUE ("device_token");



ALTER TABLE ONLY "public"."user_devices"
    ADD CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_sizes"
    ADD CONSTRAINT "user_preferred_sizes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_products_pipeline_run_id" ON "public"."products_clean" USING "btree" ("pipeline_run_id");



CREATE INDEX "idx_subscriptions_customer_id" ON "public"."subscriptions" USING "btree" ("stripe_customer_id_live");



CREATE INDEX "idx_subscriptions_subscription_id" ON "public"."subscriptions" USING "btree" ("stripe_subscription_id");



CREATE INDEX "orders_v2_customer_id_idx" ON "public"."orders_v2" USING "btree" ("customer_id");



CREATE INDEX "orders_v2_status_idx" ON "public"."orders_v2" USING "btree" ("status");



CREATE INDEX "orders_v2_stylist_id_idx" ON "public"."orders_v2" USING "btree" ("stylist_id");



CREATE INDEX "user_devices_device_token_idx" ON "public"."user_devices" USING "btree" ("device_token");



CREATE INDEX "user_devices_user_id_idx" ON "public"."user_devices" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "trg_update_users_email" AFTER INSERT ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_profile_email"();



ALTER TABLE ONLY "public"."carts"
    ADD CONSTRAINT "cart_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."image_preferences"
    ADD CONSTRAINT "image_preferences_explore_request_id_fkey" FOREIGN KEY ("explore_request_id") REFERENCES "public"."explore_requests"("id");



ALTER TABLE ONLY "public"."image_preferences"
    ADD CONSTRAINT "image_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."order_cart_product"
    ADD CONSTRAINT "order_cart_product_order_cart_id_fkey" FOREIGN KEY ("order_cart_id") REFERENCES "public"."order_carts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_cart_product"
    ADD CONSTRAINT "order_cart_product_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products_clean"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_carts"
    ADD CONSTRAINT "order_carts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders_v2"("id");



ALTER TABLE ONLY "public"."order_suggestion"
    ADD CONSTRAINT "order_suggestion_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders_v2"("id");



ALTER TABLE ONLY "public"."orders_v2"
    ADD CONSTRAINT "orders_v2_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders_v2"
    ADD CONSTRAINT "orders_v2_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders_v2"
    ADD CONSTRAINT "orders_v2_stylist_id_fkey" FOREIGN KEY ("stylist_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."product_preferences"
    ADD CONSTRAINT "product_preferences_duplicate_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."explore_requests"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_preferences"
    ADD CONSTRAINT "product_preferences_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products_clean"("id");



ALTER TABLE ONLY "public"."product_preferences"
    ADD CONSTRAINT "product_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_purchase"
    ADD CONSTRAINT "product_purchase_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products_clean"("id");



ALTER TABLE ONLY "public"."product_purchase"
    ADD CONSTRAINT "product_purchase_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipment"("id");



ALTER TABLE ONLY "public"."product_purchase_suggestion"
    ADD CONSTRAINT "product_purchase_suggestion_order_suggestion_id_fkey" FOREIGN KEY ("order_suggestion_id") REFERENCES "public"."order_suggestion"("id");



ALTER TABLE ONLY "public"."product_purchase_suggestion"
    ADD CONSTRAINT "product_purchase_suggestion_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products_clean"("id");



ALTER TABLE ONLY "public"."products_clean_archive"
    ADD CONSTRAINT "products_clean_archive_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."products_clean_archive"
    ADD CONSTRAINT "products_clean_archive_brand_id_fkey1" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products_clean_archive"
    ADD CONSTRAINT "products_clean_archive_sub_brand_id_fkey" FOREIGN KEY ("sub_brand_id") REFERENCES "public"."sub_brands"("id") ON DELETE SET DEFAULT;



ALTER TABLE ONLY "public"."products_clean"
    ADD CONSTRAINT "products_clean_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."products_clean"
    ADD CONSTRAINT "products_clean_brand_id_fkey1" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products_clean"
    ADD CONSTRAINT "products_clean_sub_brand_id_fkey" FOREIGN KEY ("sub_brand_id") REFERENCES "public"."sub_brands"("id") ON DELETE SET DEFAULT;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_old_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_old_brand_id_fkey1" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."explore_requests"
    ADD CONSTRAINT "requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shipment"
    ADD CONSTRAINT "shipment_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."shipment"
    ADD CONSTRAINT "shipment_order_suggestion_id_fkey" FOREIGN KEY ("order_suggestion_id") REFERENCES "public"."order_suggestion"("id");



ALTER TABLE ONLY "public"."sub_brands"
    ADD CONSTRAINT "sub_brands_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_devices"
    ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_sizes"
    ADD CONSTRAINT "user_preferred_sizes_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



CREATE POLICY "Enable read access for all users" ON "public"."users" FOR SELECT USING (true);



CREATE POLICY "Only admins can delete orders" ON "public"."orders_v2" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'ADMIN'::"public"."user_role")))));



CREATE POLICY "Users can INSERT their own row" ON "public"."users" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can SELECT their own row" ON "public"."users" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can UPDATE their own row" ON "public"."users" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can create their own orders" ON "public"."orders_v2" FOR INSERT WITH CHECK ((("auth"."uid"() = "customer_id") OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['ADMIN'::"public"."user_role", 'STYLIST'::"public"."user_role"])))))));



CREATE POLICY "Users can delete own devices" ON "public"."user_devices" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'ADMIN'::"public"."user_role"))))));



CREATE POLICY "Users can insert own devices" ON "public"."user_devices" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own devices" ON "public"."user_devices" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'ADMIN'::"public"."user_role"))))));



CREATE POLICY "Users can update their own orders, stylists/admins can update a" ON "public"."orders_v2" FOR UPDATE USING ((("auth"."uid"() = "customer_id") OR ("auth"."uid"() = "stylist_id") OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['ADMIN'::"public"."user_role", 'STYLIST'::"public"."user_role"])))))));



CREATE POLICY "Users can view own devices" ON "public"."user_devices" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'ADMIN'::"public"."user_role"))))));



CREATE POLICY "Users can view their own orders" ON "public"."orders_v2" FOR SELECT USING ((("auth"."uid"() = "customer_id") OR ("auth"."uid"() = "stylist_id") OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['ADMIN'::"public"."user_role", 'STYLIST'::"public"."user_role"])))))));



ALTER TABLE "public"."chats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chats_dev" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."external_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."external_product_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."image_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_cart_product" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_carts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_suggestion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders_v2" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_register_user_info" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_purchase" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_purchase_suggestion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sent_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."signup" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signup" ON "public"."signup" USING (true) WITH CHECK (true);



ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_devices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_sizes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT ALL ON SCHEMA "public" TO "service_role";




















































































































































































GRANT ALL ON FUNCTION "public"."bulk_update_cart_items"("items_array" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."bulk_update_cart_items"("items_array" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_update_cart_items"("items_array" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_recent_runs"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_recent_runs"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_recent_runs"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user"("user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user"("user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user"("user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user"("user_id" "uuid", "cachebuster" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user"("user_id" "uuid", "cachebuster" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user"("user_id" "uuid", "cachebuster" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."list_users"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."list_users"("cachebuster" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."list_users"("cachebuster" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_users"("cachebuster" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profile_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_profile_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profile_email"() TO "service_role";


















GRANT ALL ON TABLE "public"."brands" TO "anon";
GRANT ALL ON TABLE "public"."brands" TO "authenticated";
GRANT ALL ON TABLE "public"."brands" TO "service_role";



GRANT ALL ON TABLE "public"."carts" TO "anon";
GRANT ALL ON TABLE "public"."carts" TO "authenticated";
GRANT ALL ON TABLE "public"."carts" TO "service_role";



GRANT ALL ON TABLE "public"."chats" TO "anon";
GRANT ALL ON TABLE "public"."chats" TO "authenticated";
GRANT ALL ON TABLE "public"."chats" TO "service_role";



GRANT ALL ON TABLE "public"."chats_backup" TO "anon";
GRANT ALL ON TABLE "public"."chats_backup" TO "authenticated";
GRANT ALL ON TABLE "public"."chats_backup" TO "service_role";



GRANT ALL ON TABLE "public"."chats_dev" TO "anon";
GRANT ALL ON TABLE "public"."chats_dev" TO "authenticated";
GRANT ALL ON TABLE "public"."chats_dev" TO "service_role";



GRANT ALL ON TABLE "public"."explore_requests" TO "anon";
GRANT ALL ON TABLE "public"."explore_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."explore_requests" TO "service_role";



GRANT ALL ON TABLE "public"."external_images" TO "anon";
GRANT ALL ON TABLE "public"."external_images" TO "authenticated";
GRANT ALL ON TABLE "public"."external_images" TO "service_role";



GRANT ALL ON SEQUENCE "public"."external_images_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."external_images_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."external_images_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."external_product_images" TO "anon";
GRANT ALL ON TABLE "public"."external_product_images" TO "authenticated";
GRANT ALL ON TABLE "public"."external_product_images" TO "service_role";



GRANT ALL ON TABLE "public"."image_preferences" TO "anon";
GRANT ALL ON TABLE "public"."image_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."image_preferences" TO "service_role";



GRANT ALL ON SEQUENCE "public"."image_preferences_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."image_preferences_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."image_preferences_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_cart_product" TO "anon";
GRANT ALL ON TABLE "public"."order_cart_product" TO "authenticated";
GRANT ALL ON TABLE "public"."order_cart_product" TO "service_role";



GRANT ALL ON TABLE "public"."order_carts" TO "anon";
GRANT ALL ON TABLE "public"."order_carts" TO "authenticated";
GRANT ALL ON TABLE "public"."order_carts" TO "service_role";



GRANT ALL ON TABLE "public"."order_suggestion" TO "anon";
GRANT ALL ON TABLE "public"."order_suggestion" TO "authenticated";
GRANT ALL ON TABLE "public"."order_suggestion" TO "service_role";



GRANT ALL ON TABLE "public"."orders_v2" TO "anon";
GRANT ALL ON TABLE "public"."orders_v2" TO "authenticated";
GRANT ALL ON TABLE "public"."orders_v2" TO "service_role";



GRANT ALL ON TABLE "public"."pending_register_user_info" TO "anon";
GRANT ALL ON TABLE "public"."pending_register_user_info" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_register_user_info" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pending_register_user_info_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pending_register_user_info_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pending_register_user_info_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."product_preferences" TO "anon";
GRANT ALL ON TABLE "public"."product_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."product_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."product_purchase" TO "anon";
GRANT ALL ON TABLE "public"."product_purchase" TO "authenticated";
GRANT ALL ON TABLE "public"."product_purchase" TO "service_role";



GRANT ALL ON TABLE "public"."product_purchase_suggestion" TO "anon";
GRANT ALL ON TABLE "public"."product_purchase_suggestion" TO "authenticated";
GRANT ALL ON TABLE "public"."product_purchase_suggestion" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."products_clean" TO "anon";
GRANT ALL ON TABLE "public"."products_clean" TO "authenticated";
GRANT ALL ON TABLE "public"."products_clean" TO "service_role";



GRANT ALL ON TABLE "public"."products_clean_archive" TO "anon";
GRANT ALL ON TABLE "public"."products_clean_archive" TO "authenticated";
GRANT ALL ON TABLE "public"."products_clean_archive" TO "service_role";



GRANT ALL ON TABLE "public"."sent_notifications" TO "anon";
GRANT ALL ON TABLE "public"."sent_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."sent_notifications" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sent_notifications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sent_notifications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sent_notifications_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."shipment" TO "anon";
GRANT ALL ON TABLE "public"."shipment" TO "authenticated";
GRANT ALL ON TABLE "public"."shipment" TO "service_role";



GRANT ALL ON TABLE "public"."signup" TO "anon";
GRANT ALL ON TABLE "public"."signup" TO "authenticated";
GRANT ALL ON TABLE "public"."signup" TO "service_role";



GRANT ALL ON SEQUENCE "public"."signup_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."signup_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."signup_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sub_brands" TO "anon";
GRANT ALL ON TABLE "public"."sub_brands" TO "authenticated";
GRANT ALL ON TABLE "public"."sub_brands" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."temp_users" TO "anon";
GRANT ALL ON TABLE "public"."temp_users" TO "authenticated";
GRANT ALL ON TABLE "public"."temp_users" TO "service_role";



GRANT ALL ON TABLE "public"."user_devices" TO "anon";
GRANT ALL ON TABLE "public"."user_devices" TO "authenticated";
GRANT ALL ON TABLE "public"."user_devices" TO "service_role";



GRANT ALL ON TABLE "public"."user_sizes" TO "anon";
GRANT ALL ON TABLE "public"."user_sizes" TO "authenticated";
GRANT ALL ON TABLE "public"."user_sizes" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























RESET ALL;
