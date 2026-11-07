-- Synthetic development seed for local testing
-- Owner ID corresponds to a test auth user

DO $$
DECLARE
  test_user_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Ensure test owner is in allowlist
  INSERT INTO allowed_owners (owner_id)
  VALUES (test_user_id)
  ON CONFLICT (owner_id) DO NOTHING;

  -- Create synthetic profile
  INSERT INTO profiles (owner_id, name, timezone, language, graduation_month, cgpa, preferences)
  VALUES (
    test_user_id,
    'Dev Candidate',
    'Asia/Kolkata',
    'python',
    '2026-12',
    7.60,
    '{"theme": "workbench", "sound": false}'::jsonb
  )
  ON CONFLICT (owner_id) DO NOTHING;

  -- Create synthetic active goal
  INSERT INTO goals (owner_id, target_role, target_companies, checkpoint_date, weekly_target_minutes, ramp_state, planning_revision)
  VALUES (
    test_user_id,
    'SDE / Backend',
    ARRAY['CRED', 'BigTech'],
    '2026-11-30',
    1080,
    'baseline',
    1
  )
  ON CONFLICT (owner_id) DO NOTHING;
END $$;
