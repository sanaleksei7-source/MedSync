# MedSync

AI medical scribe for clinics in Kyrgyzstan. The system listens to the doctor–patient conversation, transcribes it, pulls out the key information and fills in medical documents (anamnesis, справка, направление, больничный, etc.). The doctor reviews the draft, fixes anything wrong, signs it, and the document is sent to the patient's medical record.

- Live demo: https://smart-scribe-clinic.lovable.app (demo account: ask the owner, never commit credentials)
- Built in Lovable, two-way synced with this GitHub repo (main branch only). Lovable stack: React + TypeScript + Tailwind + shadcn/ui.
- UI language: Russian (Kyrgyz later).

## Working rules

- Lovable and Claude Code both write to `main`. Always `git pull` before starting and push small commits, so Lovable doesn't conflict with us.
- Don't change the visual design or unrelated pages unless asked. Lovable handles UI polish; Claude Code handles logic, data structures and integrations.
- All patient data in the repo is fake demo data. Never add real patient data.
- Do not claim HIPAA/GDPR compliance in the UI (current footer does). HIPAA is US law and compliance isn't verified. Refer to Kyrgyz personal-data law instead, after a lawyer confirms wording.

## Current state of the demo (reviewed 23 Nov 2026)

Pages: `/` (consent screen), `/home`, `/patients`, `/appointment`, `/history`, `/analytics`, settings.
The appointment page is a scripted demo: transcript lines appear on a timer, the document fills to 100%, then it loops. "Подтвердить и сохранить" is disabled until 100%.

### Known problems, by priority

1. **AI invents facts in the demo.** The document contains things never said in the transcript: "38.5°C", "сухой кашель", "ЧСС 88", "температура 37.8°C", "зев гиперемирован", "состояние средней тяжести". Fix both the script (doctor says vitals out loud) and the product (source tracking, see spec below).
2. **Wrong patient ID format.** UI says "ИИН" with 12-digit Kazakh numbers. Kyrgyzstan uses **ПИН, 14 digits** (first digit = sex, then date of birth DDMMYYYY, then serial). Rename the field and regenerate demo IDs consistent with each patient's sex and birth date.
3. **Core features missing:** choosing document type (справка, направление, больничный), editing text, doctor signature step (should be ЭЦП), "send to medical record" step. No reachable screen after saving.
4. **Small inconsistencies:** transcript has no speaker labels and is missing the doctor's question "Горло болит?" before "Да, боль в горле…"; home page date hardcoded to 22 July 2026; Иванова is "Сейчас" on home but "Завершён" in History; Петров 07:30 in History vs 09:30 in schedule; analytics chart skips June; metrics like "Точность речи 97.8%" and "Экономия 42%" look real but are placeholders, label them as demo data.

## Spec: source highlighting (next feature to build)

Goal: the doctor sees where every fact came from and only reviews uncertain parts.

- Transcript lines are numbered (#1, #2…) and labelled "Врач" / "Пациент".
- Each statement in each document section is stored as `{ text: string, sourceIds: number[] }`.
- A statement with sources shows small grey chips "#N"; hover/click highlights and scrolls to that transcript line.
- A statement with empty `sourceIds` gets a yellow background and a notice "Это не прозвучало в разговоре" with buttons: Оставить / Убрать / Исправить (inline edit).
- Header badge: "N фактов без источника" (yellow) → "Всё проверено" (green).
- Button "Подписать ЭЦП" stays clickable; if unchecked facts remain, it scrolls to the first one and shows "Сначала проверьте жёлтые факты".
- Every doctor action (kept / removed / edited) is written to a per-document change log with timestamp.

## Idea to add after that

Allergy check: patient card has allergies (e.g. Иванова: пенициллин). If a prescription in the transcript conflicts (e.g. амоксициллин, a penicillin-class drug), show a warning before signing.

## Integration plan: Tunduk

- "Түндүк" is Kyrgyzstan's government data-exchange bus (СМЭВ), not the storage itself. Medical records live in the Ministry of Health's information system; MedSync would send signed documents there **through** Tunduk. Becoming a participant requires registering a security server with Tunduk and an agreement with the Ministry of Health.
- Precedent: since 2025 private clinics can connect to the Ministry's e-sick-leave module via a public offer agreement (MoH + UNDP digital health programme).
- Don't build the real integration yet. First prove value in one clinic: record → draft → doctor edits → sign → PDF/export, measuring minutes saved per appointment.

## Open questions for the team

- Which items to fix before the next demo, and who owns each.
- Source highlighting now, or only fix the demo script for now.
- Which document types first: справка, направление or больничный.
- Allergy check in the next version or later.
