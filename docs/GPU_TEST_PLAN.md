# Larger-model and GPU test plan

Goal: find out whether a larger speech model fixes what the `small` model got wrong, and whether it can run fast enough on hardware the clinic could realistically have. Fictional data only. Nothing in this plan has been run yet.

## 1. What we are trying to learn

Two separate questions. Keeping them apart saves time and money.

1. **Accuracy:** do larger models recognize drug names, doses and medical phrases well enough? This can be tested **now, on this laptop's CPU**, just slowly. No GPU needed.
2. **Speed:** can the model that passes the accuracy test run fast enough for real use? This needs the hardware you would actually deploy on, so it is tested second.

Baseline to beat (owner's voice, 11 recordings, `small`, CPU): word error 27 %, drug names right 1 of 10, numbers 91 %, speed about 1.1× real time. See `docs/ASR_DESIGN.md` section 9.

## 2. Step A — accuracy of larger models on this CPU

| Model | File | Size | SHA-256 (from the project page) | Notes |
|---|---|---|---|---|
| `large-v3-turbo` | `ggml-large-v3-turbo.bin` | 1.62 GB | `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69` | Recommended first candidate: near-large accuracy, much faster than `large-v3` |
| `medium` | `ggml-medium.bin` | 1.53 GB | `6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208` | Middle option; compare against turbo |
| `large-v3` | `ggml-large-v3.bin` | 3.10 GB | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` | Reference for the best accuracy; only if turbo disappoints |

All from `huggingface.co/ggerganov/whisper.cpp` (the whisper.cpp author's repository). **I will not download any of these without your explicit OK**, and I will verify each checksum against the value above. The program (`whisper-server.exe`) is already installed; only the model file changes.

**Method (same for every model):**
1. Download the model into `C:\Users\User\medsync-asr\models\` (outside OneDrive), verify SHA-256.
2. You start a second `whisper-server` on a different port with that model (same command as before, different `-m` and `--port 8081`).
3. I run, against that port: `asr:eval` (accuracy, drug recall, numbers, speed), `asr:flags` (do the yellow flags catch errors, and at what threshold), on the same 11 recordings and the 5 synthetic sentences.
4. Results go into one comparison table in `docs/ASR_DESIGN.md`.

**Expected cost on this laptop:** CPU speed will be several times slower than real time for these models, so the 11 takes (about 2 minutes of audio) may take 10 to 30 minutes per model. That is acceptable for an accuracy test and says nothing about deployment speed.

**Pass bars (proposed hypotheses; to be agreed with practising doctors, not established facts):** drug names right ≥ 8 of 10 on this set, numbers ≥ 98 %, word error ≤ 15 %, no lost "не / нет". The set is small, so passing means "worth a larger test", not "safe".

## 3. Step B — speed on GPU hardware

Only if a model passes Step A. Requirements to run the larger models acceptably:
- an **NVIDIA** GPU with at least 8 GB of video memory (12 GB is comfortable);
- a current NVIDIA driver; the whisper.cpp builds for Windows come in CUDA 11.8 and CUDA 12.4 variants (about 735 to 766 MB each), chosen by the driver version;
- Windows or Linux with the same `whisper-server` command, using the CUDA build.

Where to get such a machine, cheapest first:
1. **A PC you or a colleague already own with an NVIDIA gaming GPU.** Free. Best first choice.
2. **A rented cloud GPU for one or two hours** (cost roughly a few dollars at most). Creating the account and paying are done by you, not me. Audio would be uploaded to a third party, so use only the fictional recordings. The owner's voice is the owner's own data, and the owner decides.
3. **A clinic server or workstation with a GPU** (the real target). The hardware inventory you said you'd send later.

What to measure: real-time factor with and without word confidence (target ≤ 0.5), memory use, and whether accuracy matches Step A (it should be identical; only speed changes).

Intel integrated graphics (this laptop) are **not** a realistic route: the prebuilt whisper.cpp downloads cover NVIDIA CUDA and Qualcomm Adreno, not Intel graphics.

## 4. Privacy for the test
- Only the fictional script recordings and the synthetic voice. No real patients, no colleagues' voices without their OK.
- Models stay on your computer; a rented GPU is the only case where audio leaves it.
- Keep the recordings outside the repository (they are now git-ignored and the secret scan rejects tracked audio). Consider moving `docs/recordings/` out of the OneDrive-synced project folder.
- Delete anything uploaded to a rented machine and stop the machine when finished.

## 5. If a larger model still fails
Drug names and doses are the highest-risk words. If even `large-v3` gets them wrong, the speech model is the wrong tool for those words, and the product should not depend on it:
- **Structured entry for drugs and doses:** the doctor picks the drug from the clinic's formulary with autocomplete, and the dose from fields; speech only fills the free-text parts. This also makes the allergy check reliable.
- **Fine-tuning** on in-clinic audio, which needs a proper dataset and legal basis for recordings.
- **Another engine** (including an in-country provider), subject to the legal answers.

## 6. A bigger test set (needed for any real decision)
Eleven takes from one speaker prove little. Before trusting any model:
- 30 to 60 minutes of fictional scripted visits;
- at least 10 speakers: men and women, Russian with different accents, doctors where possible;
- different rooms and noise levels, different phones or microphones;
- silence-only and noise-only recordings (the invented-text check);
- the clinic's real drug list in `src/data/drugs.ts` instead of the demo list.

## 7. Order of work and what I need from you
1. **Your OK to download `large-v3-turbo` (1.62 GB)**, and whether to also get `medium` (1.53 GB). Then I download, verify and report.
2. You start the second whisper server on port 8081 (I give the exact command).
3. I run the comparison and report a table.
4. In parallel: tell me what NVIDIA hardware, if any, you or the clinic can use for Step B.
5. Later: more speakers and rooms (section 6), and the clinic drug list.

Rough timeline: Step A about one afternoon (mostly download and waiting), Step B about an hour once the machine is available, section 6 several days of recording.
