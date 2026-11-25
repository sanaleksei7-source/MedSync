# Speech recognition on clinic hardware — design

Implements decision record D1 from `docs/PHASE1_ARCHITECTURE.md`. Status: the application side is built and tested with a stand-in engine. **No speech model has been run yet**, so every accuracy and speed statement below is a plan or a rough estimate, not a measurement. Fictional data only.

## 1. Architecture

```
Doctor's browser                  MedSync Node server                 ASR service (clinic machine)
┌─────────────────────┐  PCM      ┌──────────────────────┐  WAV       ┌─────────────────────────┐
│ microphone          │ 16 kHz    │ POST /api/asr        │ multipart  │ whisper.cpp "whisper-   │
│ → AudioWorklet      │ mono      │ • session + role     │ → /inference│  server" (or compatible)│
│ → pause segmenter   ├──────────►│ • size / rate limits │───────────►│ Whisper-class model     │
│ → editable transcript│ per phrase│ • silence + noise    │  {text}    │ bound to 127.0.0.1      │
└─────────────────────┘           │   filter             │◄───────────┴─────────────────────────┘
                                  │ • audit: seconds only│
                                  └──────────────────────┘
```

- **Capture:** the browser records at 16 kHz mono with an AudioWorklet (`public/pcm-worklet.js`). Sound is never played back, never written to a file, never stored in the browser.
- **Segmentation:** `src/audio/segmenter.ts` cuts the stream at pauses (0.7 s), keeps 0.3 s of lead-in, caps a segment at 25 s, drops clicks shorter than 0.4 s of voiced sound, and adapts its loudness threshold to room noise. Silence is never sent. This also reduces the model's "hallucinations".
- **Server:** `POST /api/asr` (`server/app.ts`) needs a logged-in doctor, accepts raw 16-bit PCM only (0.3–30 s), limits 60 segments per user per minute, rejects silence by loudness, drops known Whisper hallucination phrases ("Продолжение следует", "Субтитры…", "Спасибо за просмотр"), and returns the text. It records only the duration of each segment in the audit log.
- **Engine:** `server/asr/engine.ts`. `HttpWhisperEngine` talks to a whisper.cpp-compatible `POST /inference` (multipart file, `language=ru`, `response_format=json`, answer `{"text": "..."}`). `MockEngine` (`ASR_ENGINE=mock`) returns a clearly labelled test string so the microphone path can be checked without a model.
- **Local-only rule (enforced in code):** `ASR_URL` must point to the same machine. A LAN address (10.x, 192.168.x, 172.16–31.x) is accepted only with `https`. Any other host is refused unless `ASR_ALLOW_REMOTE=1` **and** `https` — meant for a legally approved in-country service only. The server refuses to start with an unsafe address.
- **Speaker labels:** diarization (separating voices) is not attempted. The "Врач / Пациент" buttons stay; the label is the one selected when the phrase ends. A realistic upgrade is two microphones (one per speaker) so the channel decides the speaker.
- **Output:** numbered lines `{id, speaker, text}`, the same format the rest of the app uses. The doctor can edit or delete any line before "Составить документ"; the page blocks drafting while phrases are still being recognized.

Configuration (`.env`, not committed):

```
ASR_URL=http://127.0.0.1:8080        # whisper.cpp server on this machine
# ASR_ENGINE=mock                    # test the microphone path without a model
```

## 2. Model and hardware (proposal, not measured)

| Tier | Where it runs | Model | Rough memory | What to expect |
|---|---|---|---|---|
| A: pilot on a doctor's PC | CPU only, modern 6–8 cores, 16 GB RAM | Whisper `small` (≈244 M parameters), or `medium` | `small`: about 1–2 GB; `medium`: about 3–5 GB | `small` is usually faster than real time on such a CPU but is the least accurate on Russian medical terms. `medium` is slower and may be close to real time. Fine for trying the workflow, **not** a basis for trusting drug names or doses |
| B: clinic server with a GPU | NVIDIA GPU with 8 GB+ VRAM (12 GB comfortable) | Whisper `large-v3` or `large-v3-turbo` | roughly 4–10 GB VRAM depending on the runtime and precision | The best open option for Russian. Typically many times faster than real time on a GPU |

Delay per minute of audio: with the pause-based design, a phrase appears after the speaker pauses plus the processing time for that phrase. As a very rough planning figure from general experience (not measured here): Tier B well under 10 s of processing per minute of audio; Tier A between a few seconds and about one minute per minute of audio depending on model and CPU. **Do not rely on these numbers.** `npm run asr:eval` reports the real-time factor (processing time ÷ audio length) on the actual machine; a factor below 1 means keeping up with the conversation.

Notes:
- Kyrgyz: general open models handle it poorly or not at all. Treat Kyrgyz as a later project with its own test set and probably fine-tuning.
- Where weights come from: download the model file once from the project's official source, record its SHA-256, keep it outside synced folders (OneDrive), and run the service with no internet access afterwards.
- Questions I need answered: see §6.

## 3. How to measure accuracy before anyone trusts it

Tool: `npm run asr:eval -- <folder>` (`scripts/asr-eval.ts`, metrics in `server/asr/metrics.ts`, 19 tests on the metric code).

**Test set (to be built, fictional only):**
- At least 3 hours of audio, at least 10 speakers (men and women, doctors, Russian with Kyrgyz and other accents), scripted realistic visits read aloud by doctors or volunteers, never real patients.
- Real clinic conditions: room noise, door, phone, fan, a second voice, fast speech, quiet speech, a mask.
- Reference transcripts typed by two people; disagreements resolved. Numbers written as digits.
- A separate set of silence and noise recordings (`silence-*.wav`) to measure invented text.
- Format: WAV, 16-bit, mono, 16 000 Hz (`ffmpeg -i in.mp3 -ac 1 -ar 16000 out.wav`).
- Replace `server/asr/lexicon.ts` with the clinic's real drug list, including trade names.

**What is measured (per file and overall):**
- **WER / CER** (word / character error rate) — general accuracy.
- **Drug recall** — every drug name in the reference must appear in the output (stem match).
- **Number recall** — every number (temperature, pulse, dose) must match exactly; "88" heard as "80" counts as a miss. This is the metric that matters most for patient safety.
- **Negation errors** — lost or added "не / нет / без" (changes the meaning: "аллергии нет" versus "аллергия").
- **Invented words per minute of silence** — hallucinations.
- **Real-time factor** — speed on the real hardware.

**Proposed starting acceptance bars — hypotheses to agree with practising doctors, not established facts:** WER ≤ 12 %, drug recall ≥ 98 %, number recall ≥ 98 %, negation errors ≤ 1 per 100 negations, ≤ 1 invented word per minute of silence, real-time factor ≤ 0.5. Run the same set on every candidate model and size, plus a noisy variant, and repeat after any model, runtime or settings change.

**Even if every bar is met,** the doctor still reads and corrects the text. The editable transcript and the source-tracking in the document exist because no speech model is error-free.

## 4. Remaining privacy and safety risks in this design

| # | Risk | Status / mitigation |
|---|---|---|
| 1 | Audio leaves the clinic | Mitigated in code: loopback only, LAN only over https, anything else refused. Still depends on correct deployment |
| 2 | Plain-text audio on a LAN | `http` refused for LAN addresses; `https` certificates must be set up by the operator |
| 3 | **Temporary files in the ASR service.** whisper.cpp's server can write temporary audio files (for example when it converts formats). Our client sends ready WAV, so conversion should not be needed, but this is **not verified** | Check the options of the exact version you install; do not enable format conversion; point any temp directory to a RAM disk or an encrypted folder; confirm by watching the folder during a test |
| 4 | **Logs in the ASR service or its console** might print recognized text | Not verified. Run it with logging off or redirected to nowhere, as a separate OS user; our own server logs only segment durations |
| 5 | **The project folder is inside OneDrive** (`Рабочий стол` is synced), so `data/`, models and any temp files would upload to the cloud | Keep `data/`, model files and temp folders outside synced locations on any machine that sees real data |
| 6 | Audio or text in swap / page file / hibernation file | Full-disk encryption (BitLocker) on the clinic machine |
| 7 | **Clipboard**: "Копировать текст" puts the transcript in the clipboard, and Windows clipboard history (Win+V) can keep it | Disable clipboard history on clinic machines, or remove the button for real use |
| 8 | **Transcript edits are not audited.** The doctor can change a line and nothing records who changed what | Gap. Needs server-held drafts with an edit history (Phase 1 limitation 1) |
| 9 | **The separate "Составить документ" step sends the transcript to a language model (Anthropic).** Speech recognition being local does not fix this | Remains blocked by D2 and the legal answer; needs de-identification and a processing agreement, or a model inside the jurisdiction |
| 10 | Whisper invents text on silence or noise | Mitigated by the segmenter, loudness gate and phrase filter. The filter is a short list and will not catch everything; measured by the silence set |
| 11 | Recognition errors on drug names, numbers and negations | Editable transcript, and the document's sourcing and allergy check. The allergy check works on the transcript text, so a misheard drug name can hide a conflict |
| 12 | Wrong speaker label | Manual switch; a mislabelled line can change "со слов пациента" |
| 13 | Supply chain: model weights, whisper.cpp binary, npm packages | Pin versions, record checksums, download from the official source only, review before installing |
| 14 | Recording consent and retention | Legal questions 3 and 5 in `docs/LEGAL_QUESTIONS_RU.md`. Audio is not stored, which sidesteps retention but not consent |
| 15 | Microphone permission and shared machines | The browser asks per site; use named user accounts on clinic PCs |
| 16 | Session cookie and rate limits protect the endpoint, but a logged-in doctor's machine that is compromised can submit audio | Normal endpoint security; out of scope here |

## 5. Verification done so far

- 28 checks for the engine layer: WAV build and parse, rejection of wrong formats, the local-only address policy (including a look-alike host and `172.32.x`), hallucination phrases, a fake whisper.cpp-style server (multipart request, `language=ru`, trimmed text, error handling).
- 19 checks for the accuracy metrics (WER, CER, drug recall, number recall, negations, hallucination rate).
- 11 checks for the pause segmenter on synthetic audio, run repeatedly because the test noise is random. They found and fixed a real flaw (short clicks were passing as speech).
- 16 new checks in the server integration test for `/api/asr`: login, role, content type, sample rate, odd and too-short and too-long lengths, silence skipped without calling the engine, hallucination dropped, engine failure not leaking details, service-not-configured, duration-only audit records, no text in the audit log, per-user rate limit.
- Browser: the audio worklet loads under the strict content-security policy and delivers 128-sample 32-bit float frames from a 16 kHz context.
- **Not verified:** a real microphone, a real speech model, the speed and accuracy of anything, the signed-in "Живая запись" page in a browser, and whisper.cpp's actual options and temp-file behaviour.

## 6. What I need from you

1. **Hardware at the clinic:** is there a PC or server with an NVIDIA GPU (which model, how much VRAM)? If not, how many CPU cores and how much RAM does the doctor's computer have? This decides Tier A or B.
2. **May I download a model for a real test?** I will not fetch weights without your OK. I would need to: install or download a whisper.cpp build and one model file (for example `small`, a few hundred MB; `large-v3` is a few GB), from the official project pages, and then run the service on your computer. Tell me the model, source and size you accept.
3. **Some real-sounding audio** to measure with: even 20–30 minutes of fictional scripted visits recorded by you or colleagues, in WAV, is a useful first set.
4. **Network:** will doctors' computers talk to one clinic server (then the ASR service needs https inside the clinic) or each run their own (then localhost is enough)?
