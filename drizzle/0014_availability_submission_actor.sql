ALTER TABLE availability_requests ADD COLUMN submitted_by_account_id INTEGER REFERENCES accounts(id);
