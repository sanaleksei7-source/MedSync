-- Учётные записи (шаг 3.5). Секрет второго фактора лежит только в зашифрованном поле secrets
-- (вместе с ожидающим подтверждения новым секретом); хэш пароля — scrypt, как и раньше.
CREATE TABLE users (
  id                  text        PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  username            text        NOT NULL CHECK (username = lower(username)),
  name                text        NOT NULL,
  role                text        NOT NULL CHECK (role IN ('doctor', 'admin', 'auditor')),
  password_hash       text        NOT NULL,
  assigned_patients   text        NOT NULL DEFAULT '[]',
  disabled            boolean     NOT NULL DEFAULT false,
  setup               text        CHECK (setup IS NULL OR setup IN ('password', 'totp')),
  password_changed_at text,
  key_id              text        NOT NULL,
  secrets             bytea       NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_username ON users (username);
