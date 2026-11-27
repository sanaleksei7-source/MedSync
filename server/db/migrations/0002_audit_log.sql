-- Журнал аудита (шаг 3.4). Только дописывается: изменить, удалить или очистить записи нельзя даже прямым запросом к базе.
-- Каждая запись хранит хэш предыдущей (хэш-цепочка), поэтому вставка «в середину» или с пропуском отвергается самой базой.
-- time и detail хранятся строками ровно в том виде, в каком от них считался хэш (jsonb переставил бы ключи и сломал проверку).
CREATE TABLE audit_log (
  seq       bigint PRIMARY KEY CHECK (seq >= 1),
  time      text   NOT NULL,
  actor     text   NOT NULL,
  action    text   NOT NULL,
  target    text,
  detail    text,
  prev_hash text   NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash      text   NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$')
);

CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
DECLARE
  last_seq  bigint;
  last_hash text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'журнал аудита только дописывается' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT seq, hash INTO last_seq, last_hash FROM audit_log ORDER BY seq DESC LIMIT 1;
  IF NEW.seq <> COALESCE(last_seq, 0) + 1 OR NEW.prev_hash <> COALESCE(last_hash, repeat('0', 64)) THEN
    RAISE EXCEPTION 'запись не продолжает цепочку журнала' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only BEFORE INSERT OR UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE FUNCTION audit_log_no_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'журнал аудита нельзя очистить' USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_truncate();
