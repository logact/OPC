CREATE TABLE "task_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"assignee_id" varchar(255) NOT NULL,
	"collaborator_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewer_id" varchar(255) NOT NULL,
	"confirmed_by" varchar(255) NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"superseded_reason" text
);
--> statement-breakpoint
CREATE TABLE "task_command_receipts" (
	"task_id" uuid NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"command" varchar(32) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_command_receipts_task_id_idempotency_key_pk" PRIMARY KEY("task_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"submitted_by" varchar(255) NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"from_status" varchar(32),
	"to_status" varchar(32) NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"reason" text,
	"details" jsonb,
	"idempotency_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"department_id" uuid NOT NULL,
	"creator_id" varchar(255) NOT NULL,
	"target" jsonb,
	"required_skill_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"assignee_id" varchar(255),
	"collaborator_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewer_id" varchar(255),
	"room_id" uuid,
	"latest_result_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tasks_status_check" CHECK (status in ('draft', 'assigned', 'in_progress', 'blocked', 'review', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_assignee_id_participants_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_reviewer_id_participants_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_confirmed_by_participants_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_command_receipts" ADD CONSTRAINT "task_command_receipts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_actor_id_participants_id_fk" FOREIGN KEY ("actor_id") REFERENCES "participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_results" ADD CONSTRAINT "task_results_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_results" ADD CONSTRAINT "task_results_submitted_by_participants_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_transitions" ADD CONSTRAINT "task_transitions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_transitions" ADD CONSTRAINT "task_transitions_actor_id_participants_id_fk" FOREIGN KEY ("actor_id") REFERENCES "participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creator_id_participants_id_fk" FOREIGN KEY ("creator_id") REFERENCES "participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_participants_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewer_id_participants_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_latest_result_id_task_results_id_fk" FOREIGN KEY ("latest_result_id") REFERENCES "task_results"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_assignments_task_idx" ON "task_assignments" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_assignments_assignee_idx" ON "task_assignments" USING btree ("assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_assignments_current_unique_idx" ON "task_assignments" USING btree ("task_id") WHERE "task_assignments"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "task_events_task_idx" ON "task_events" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_results_task_idx" ON "task_results" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_transitions_task_idx" ON "task_transitions" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_transitions_command_unique_idx" ON "task_transitions" USING btree ("task_id","idempotency_key","to_status");--> statement-breakpoint
CREATE INDEX "tasks_department_idx" ON "tasks" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "tasks_creator_idx" ON "tasks" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tasks_reviewer_idx" ON "tasks" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "tasks_status_updated_idx" ON "tasks" USING btree ("status","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_room_unique_idx" ON "tasks" USING btree ("room_id") WHERE "tasks"."room_id" is not null;
