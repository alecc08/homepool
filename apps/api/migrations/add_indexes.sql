-- Manual migration — run once in prod if create_all doesn't create the indexes
-- (SQLModel creates indexes via create_all at startup — this file is a safety net)
CREATE INDEX IF NOT EXISTS ix_action_user_id ON action(user_id);
CREATE INDEX IF NOT EXISTS ix_action_product_id ON action(product_id);
