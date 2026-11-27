-- Приёмы. Всё, что содержит медицинский текст, лежит в одном зашифрованном поле payload
-- (расшифровка, черновик, решения врача, журнал изменений, подпись). Открытыми остаются только
-- служебные поля, нужные для поиска и контроля доступа.
CREATE TABLE visits (
  id          text        PRIMARY KEY CHECK (id ~ '^[0-9a-f]{32}$'),
  owner_id    text        NOT NULL,
  patient_id  text        NOT NULL,
  doc_type    text        NOT NULL,
  source      text        NOT NULL CHECK (source IN ('demo', 'live')),
  status      text        NOT NULL CHECK (status IN ('draft', 'signed')),
  version     integer     NOT NULL CHECK (version >= 1),
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  signed_hash text        CHECK (signed_hash IS NULL OR signed_hash ~ '^[0-9a-f]{64}$'),
  key_id      text        NOT NULL,
  payload     bytea       NOT NULL,
  CHECK ((status = 'signed') = (signed_hash IS NOT NULL))
);

CREATE INDEX visits_owner_status ON visits (owner_id, status);

-- Подписанный приём нельзя изменить или удалить даже напрямую в базе (защита на случай ошибки в коде).
CREATE FUNCTION visits_protect_signed() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'подписанный приём неизменяем' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER visits_protect_signed BEFORE UPDATE OR DELETE ON visits
  FOR EACH ROW EXECUTE FUNCTION visits_protect_signed();
