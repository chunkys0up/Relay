-- Sample data for local/dev testing. Run after schema.sql.

INSERT INTO cases (id, founder_name, service_type, status, advisor_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Acme Robotics', 'seed_round_prep', 'draft_ready', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'Northstar Labs', 'advisor_onboarding', 'information_needed', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('33333333-3333-3333-3333-333333333333', 'Cedar Works', 'tax_filing', 'advisor_review', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
