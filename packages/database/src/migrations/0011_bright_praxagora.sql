ALTER TABLE "tasks" DROP CONSTRAINT "tasks_status_check";--> statement-breakpoint
ALTER TABLE "task_assignments" DROP CONSTRAINT "task_assignments_reviewer_id_participants_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_department_id_departments_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_reviewer_id_participants_id_fk";
--> statement-breakpoint
DROP INDEX "tasks_department_idx";--> statement-breakpoint
DROP INDEX "tasks_reviewer_idx";--> statement-breakpoint
-- issue #130：review 状态移除，存量 review 任务改写为 completed（不可逆，升级前请备份）
UPDATE "tasks" SET "status" = 'completed' WHERE "status" = 'review';--> statement-breakpoint
ALTER TABLE "task_assignments" DROP COLUMN "collaborator_ids";--> statement-breakpoint
ALTER TABLE "task_assignments" DROP COLUMN "reviewer_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "department_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "target";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "required_skill_tags";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "collaborator_ids";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "reviewer_id";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_check" CHECK (status in ('draft', 'assigned', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled'));