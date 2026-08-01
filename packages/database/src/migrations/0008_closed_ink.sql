CREATE TABLE "authorization_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" varchar(255),
	"claimed_actor_id" varchar(255),
	"channel" varchar(16) NOT NULL,
	"action" varchar(64) NOT NULL,
	"resource_type" varchar(32) NOT NULL,
	"resource_id" varchar(255) NOT NULL,
	"department_id" uuid,
	"outcome" varchar(16) NOT NULL,
	"reason" varchar(255) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "participants" ("id", "kind", "name") VALUES ('system', 'human', 'system') ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "creator_id" varchar(255);--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "type" varchar(16);--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "department_id" uuid;--> statement-breakpoint
UPDATE "rooms" SET "creator_id" = 'system', "type" = CASE WHEN "metadata" ->> 'type' = 'direct' THEN 'direct' ELSE 'group' END;--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "creator_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "authorization_audit_actor_idx" ON "authorization_audit" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "authorization_audit_outcome_idx" ON "authorization_audit" USING btree ("outcome","created_at");--> statement-breakpoint
CREATE INDEX "authorization_audit_resource_idx" ON "authorization_audit" USING btree ("resource_type","resource_id");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_creator_id_participants_id_fk" FOREIGN KEY ("creator_id") REFERENCES "participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rooms_creator_idx" ON "rooms" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "rooms_department_idx" ON "rooms" USING btree ("department_id");
