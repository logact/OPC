CREATE TABLE IF NOT EXISTS "task_dependencies" (
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "depends_on_task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("task_id", "depends_on_task_id"),
  CONSTRAINT "task_dependencies_no_self" CHECK ("task_id" <> "depends_on_task_id")
);
CREATE INDEX IF NOT EXISTS "task_dependencies_blocker_idx" ON "task_dependencies" ("depends_on_task_id");
