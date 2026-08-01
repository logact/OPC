CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"responsibilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skill_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capability_grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_participant_id" varchar(255) NOT NULL,
	"position_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_department_leader" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"participant_id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(64) NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_staff_participant_id_staff_profiles_participant_id_fk" FOREIGN KEY ("staff_participant_id") REFERENCES "public"."staff_profiles"("participant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "departments_organization_idx" ON "departments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "departments_parent_idx" ON "departments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "positions_department_idx" ON "positions" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "staff_assignments_staff_idx" ON "staff_assignments" USING btree ("staff_participant_id");--> statement-breakpoint
CREATE INDEX "staff_assignments_position_idx" ON "staff_assignments" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_assignments_active_unique_idx" ON "staff_assignments" USING btree ("staff_participant_id","position_id") WHERE "staff_assignments"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_single_owner_idx" ON "staff_profiles" USING btree ("is_owner") WHERE "staff_profiles"."is_owner" = true;
--> statement-breakpoint
INSERT INTO "organizations" ("id", "name")
VALUES ('default', 'OPC')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
WITH "owner_candidate" AS (
	SELECT "id"
	FROM "participants"
	WHERE "kind" = 'human' AND "id" <> 'system'
	ORDER BY "created_at" ASC, "id" ASC
	LIMIT 1
)
INSERT INTO "staff_profiles" (
	"participant_id",
	"organization_id",
	"is_owner",
	"created_at",
	"updated_at"
)
SELECT
	"participants"."id",
	'default',
	COALESCE("participants"."id" = "owner_candidate"."id", false),
	"participants"."created_at",
	"participants"."created_at"
FROM "participants"
LEFT JOIN "owner_candidate" ON true
WHERE "participants"."kind" IN ('human', 'agent') AND "participants"."id" <> 'system'
ON CONFLICT ("participant_id") DO NOTHING;
